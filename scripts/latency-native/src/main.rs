//! The native latency probe (docs/latency-native.md): a window that plays a click on Z the moment the audio
//! callback next runs, the shortest path from a key press to the output that the platform's audio API allows.
//! It is the reference the web player's latency is compared against.

use std::sync::Arc;
use std::time::{Duration, Instant};

use be_music_latency_native::{
    Gaps, PressRecord, Ring, USAGE, click_frames, format_csv, format_summary, parse_options,
};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, FromSample, OutputCallbackInfo, SampleFormat, SizedSample, StreamConfig};
use winit::application::ApplicationHandler;
use winit::event::{ElementState, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Window, WindowId};

/// Presses waiting for the callback: `[index, nanoseconds since start]`.
type PressRing = Ring<2, 64>;
/// Measured presses: `[index, keysound start ns, output delay ns, buffer frames]`.
type ResultRing = Ring<4, 256>;

struct Shared {
    start: Instant,
    presses: PressRing,
    results: ResultRing,
}

fn nanos_since(start: Instant, now: Instant) -> u64 {
    now.saturating_duration_since(start).as_nanos() as u64
}

/// The audio callback: on a waiting press, the click starts at the buffer's first frame.
fn audio_callback<T: SizedSample + FromSample<f32>>(
    shared: Arc<Shared>,
    channels: usize,
    click_length: usize,
) -> impl FnMut(&mut [T], &OutputCallbackInfo) + Send + 'static {
    let mut click_remaining = 0usize;
    move |data: &mut [T], info: &OutputCallbackInfo| {
        let now = nanos_since(shared.start, Instant::now());
        let timestamp = info.timestamp();
        let output_delay = timestamp.playback.saturating_duration_since(timestamp.callback).as_nanos() as u64;
        let frames = data.len() / channels;
        while let Some([index, pressed_at]) = shared.presses.pop() {
            click_remaining = click_length;
            shared.results.push([index, now.saturating_sub(pressed_at), output_delay, frames as u64]);
        }
        for frame in data.chunks_mut(channels) {
            let value = if click_remaining > 0 {
                click_remaining -= 1;
                1.0
            } else {
                0.0
            };
            for sample in frame {
                *sample = T::from_sample(value);
            }
        }
    }
}

fn build_stream(
    device: &cpal::Device,
    config: StreamConfig,
    format: SampleFormat,
    shared: Arc<Shared>,
) -> Result<cpal::Stream, String> {
    let channels = config.channels as usize;
    let click_length = click_frames(config.sample_rate);
    let on_error = |error| eprintln!("audio error: {error}");
    macro_rules! build {
        ($sample:ty) => {
            device.build_output_stream::<$sample, _, _>(
                config,
                audio_callback::<$sample>(shared, channels, click_length),
                on_error,
                None,
            )
        };
    }
    match format {
        SampleFormat::F32 => build!(f32),
        SampleFormat::I16 => build!(i16),
        SampleFormat::I32 => build!(i32),
        SampleFormat::U16 => build!(u16),
        other => return Err(format!("unsupported sample format: {other}")),
    }
    .map_err(|error| error.to_string())
}

struct App {
    shared: Arc<Shared>,
    window: Option<Window>,
    next_index: u64,
    records: Vec<PressRecord>,
    dropped: u64,
    out: Option<String>,
    reported: bool,
}

/// Prints the distribution and writes the CSV.
fn report(records: &[PressRecord], dropped: u64, out: Option<&str>) {
    print!("{}", format_summary(records));
    if dropped > 0 {
        println!("# {dropped} press(es) dropped: the audio callback did not run");
    }
    if let Some(path) = out {
        match std::fs::write(path, format_csv(records)) {
            Ok(()) => println!("# wrote {path}"),
            Err(error) => eprintln!("cannot write {path}: {error}"),
        }
    }
}

/// Moves the measured presses from the audio callback into `records`.
fn drain(shared: &Shared, records: &mut Vec<PressRecord>) {
    while let Some([index, start, delay, frames]) = shared.results.pop() {
        records.push(PressRecord {
            index,
            keysound_start_us: start as f64 / 1000.0,
            output_delay_us: delay as f64 / 1000.0,
            buffer_frames: frames,
        });
    }
}

/// `--auto`: presses from this thread at random gaps, with no window.
fn press_automatically(shared: &Shared, presses: u32, records: &mut Vec<PressRecord>) -> u64 {
    let seed = Instant::now().duration_since(shared.start).subsec_nanos() ^ 0x9e37_79b9;
    let mut gaps = Gaps::new(seed, 300, 800);
    let mut dropped = 0;
    for index in 1..=u64::from(presses) {
        std::thread::sleep(Duration::from_millis(u64::from(gaps.next_ms())));
        if !shared.presses.push([index, nanos_since(shared.start, Instant::now())]) {
            dropped += 1;
        }
        drain(shared, records);
    }
    std::thread::sleep(Duration::from_millis(300));
    drain(shared, records);
    dropped
}

impl App {
    fn drain(&mut self) {
        let before = self.records.len();
        drain(&self.shared, &mut self.records);
        if self.records.len() != before
            && let (Some(window), Some(last)) = (&self.window, self.records.last())
        {
            window.set_title(&format!(
                "Be-Music latency probe: {} presses, last {:.2} ms",
                self.records.len(),
                last.audible_us() / 1000.0
            ));
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_none() {
            let attributes = Window::default_attributes()
                .with_title("Be-Music latency probe: press Z, Esc to finish")
                .with_inner_size(winit::dpi::LogicalSize::new(480.0, 160.0));
            match event_loop.create_window(attributes) {
                Ok(window) => self.window = Some(window),
                Err(error) => {
                    eprintln!("cannot open a window: {error}");
                    event_loop.exit();
                }
            }
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::KeyboardInput { event, .. } => {
                let pressed_at = nanos_since(self.shared.start, Instant::now());
                if event.state != ElementState::Pressed || event.repeat {
                    return;
                }
                match event.physical_key {
                    PhysicalKey::Code(KeyCode::KeyZ) => {
                        self.next_index += 1;
                        if !self.shared.presses.push([self.next_index, pressed_at]) {
                            self.dropped += 1;
                        }
                    }
                    PhysicalKey::Code(KeyCode::Escape) => event_loop.exit(),
                    _ => {}
                }
            }
            WindowEvent::CloseRequested => event_loop.exit(),
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.drain();
        event_loop.set_control_flow(ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(20)));
    }

    /// Reports here: on macOS, Quit (Cmd+Q) terminates the process without returning from `run_app`.
    fn exiting(&mut self, _: &ActiveEventLoop) {
        self.drain();
        report(&self.records, self.dropped, self.out.as_deref());
        self.reported = true;
    }
}

fn main() {
    let options = match parse_options(std::env::args().skip(1)) {
        Ok(options) => options,
        Err(message) => {
            eprintln!("{message}\n{USAGE}");
            std::process::exit(1);
        }
    };
    let host = cpal::default_host();
    let devices: Vec<cpal::Device> = host.output_devices().map(|devices| devices.collect()).unwrap_or_default();
    let name = |device: &cpal::Device| device.description().map(|d| d.name().to_string()).unwrap_or_default();
    if options.list {
        for device in &devices {
            let config = device.default_output_config();
            match config {
                Ok(config) => println!(
                    "{}: {} Hz, {} ch, {}, buffer {:?}",
                    name(device),
                    config.sample_rate(),
                    config.channels(),
                    config.sample_format(),
                    config.buffer_size()
                ),
                Err(error) => println!("{}: {error}", name(device)),
            }
        }
        return;
    }
    let device = match &options.device {
        Some(wanted) => devices.into_iter().find(|device| name(device).to_lowercase().contains(&wanted.to_lowercase())),
        None => host.default_output_device(),
    };
    let Some(device) = device else {
        eprintln!("no output device; --list shows them");
        std::process::exit(1);
    };
    let supported = device.default_output_config().unwrap_or_else(|error| {
        eprintln!("no output configuration: {error}");
        std::process::exit(1);
    });
    let mut config = supported.config();
    if let Some(frames) = options.buffer {
        config.buffer_size = BufferSize::Fixed(frames);
    }
    println!(
        "# host={} device=\"{}\" sampleRate={} channels={} format={} buffer={:?} supported={:?}",
        host.id().name(),
        name(&device),
        config.sample_rate,
        config.channels,
        supported.sample_format(),
        config.buffer_size,
        supported.buffer_size()
    );

    let shared =
        Arc::new(Shared { start: Instant::now(), presses: PressRing::default(), results: ResultRing::default() });
    let stream = build_stream(&device, config, supported.sample_format(), shared.clone()).unwrap_or_else(|error| {
        eprintln!("cannot open the output stream: {error}");
        std::process::exit(1);
    });
    stream.play().unwrap_or_else(|error| {
        eprintln!("cannot start the output stream: {error}");
        std::process::exit(1);
    });

    match options.auto {
        Some(presses) => {
            let mut records = Vec::new();
            let dropped = press_automatically(&shared, presses, &mut records);
            drop(stream);
            report(&records, dropped, options.out.as_deref());
        }
        None => {
            let event_loop = EventLoop::new().unwrap_or_else(|error| {
                eprintln!("cannot start the event loop: {error}");
                std::process::exit(1);
            });
            let mut app = App {
                shared,
                window: None,
                next_index: 0,
                records: Vec::new(),
                dropped: 0,
                out: options.out.clone(),
                reported: false,
            };
            if let Err(error) = event_loop.run_app(&mut app) {
                eprintln!("event loop error: {error}");
            }
            drop(stream);
            if !app.reported {
                app.drain();
                report(&app.records, app.dropped, app.out.as_deref());
            }
        }
    }
}
