//! The logic of the native latency probe (docs/latency-native.md) that needs no window or audio device: the
//! lock-free hand-off between the input thread and the audio callback, the click, and the statistics.

use std::sync::atomic::{AtomicU64, Ordering};

/// A single-producer, single-consumer ring of `W`-word records. Neither side blocks or allocates, so the audio
/// callback can use it.
pub struct Ring<const W: usize, const N: usize> {
    slots: [[AtomicU64; W]; N],
    head: AtomicU64,
    tail: AtomicU64,
}

impl<const W: usize, const N: usize> Default for Ring<W, N> {
    fn default() -> Self {
        Self {
            slots: std::array::from_fn(|_| std::array::from_fn(|_| AtomicU64::new(0))),
            head: AtomicU64::new(0),
            tail: AtomicU64::new(0),
        }
    }
}

impl<const W: usize, const N: usize> Ring<W, N> {
    /// Adds a record; `false` when the ring is full.
    pub fn push(&self, record: [u64; W]) -> bool {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);
        if head - tail >= N as u64 {
            return false;
        }
        for (slot, value) in self.slots[(head % N as u64) as usize].iter().zip(record) {
            slot.store(value, Ordering::Relaxed);
        }
        self.head.store(head + 1, Ordering::Release);
        true
    }

    /// Takes the oldest record.
    pub fn pop(&self) -> Option<[u64; W]> {
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Acquire);
        if tail == head {
            return None;
        }
        let slot = &self.slots[(tail % N as u64) as usize];
        let record = std::array::from_fn(|word| slot[word].load(Ordering::Relaxed));
        self.tail.store(tail + 1, Ordering::Release);
        Some(record)
    }
}

/// Frames in the click: 1 ms at full scale, the same click as the latency jig's test chart.
pub fn click_frames(sample_rate: u32) -> usize {
    (sample_rate as usize).div_ceil(1000)
}

/// One press: when the audio callback picked it up and when its first frame is expected at the output.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PressRecord {
    pub index: u64,
    /// From the key event reaching the program to the callback that starts the click.
    pub keysound_start_us: f64,
    /// From that callback to the predicted playback of the buffer's first frame, as the host reports it.
    pub output_delay_us: f64,
    /// The callback's buffer, in frames.
    pub buffer_frames: u64,
}

impl PressRecord {
    /// From the key event to the predicted playback of the click.
    pub fn audible_us(&self) -> f64 {
        self.keysound_start_us + self.output_delay_us
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Statistics {
    pub count: usize,
    pub min: f64,
    pub median: f64,
    pub p95: f64,
    pub p99: f64,
    pub max: f64,
    pub mean: f64,
    /// Population standard deviation: the jitter.
    pub stdev: f64,
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    let index = (sorted.len() - 1) as f64 * p;
    let lower = index.floor() as usize;
    let upper = index.ceil() as usize;
    sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower as f64)
}

/// The distribution of `values`, interpolating percentiles like the jig's `analyze.ts`; `None` for none.
pub fn summarize(values: &[f64]) -> Option<Statistics> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let mean = sorted.iter().sum::<f64>() / sorted.len() as f64;
    let variance = sorted.iter().map(|value| (value - mean).powi(2)).sum::<f64>() / sorted.len() as f64;
    Some(Statistics {
        count: sorted.len(),
        min: sorted[0],
        median: percentile(&sorted, 0.5),
        p95: percentile(&sorted, 0.95),
        p99: percentile(&sorted, 0.99),
        max: sorted[sorted.len() - 1],
        mean,
        stdev: variance.sqrt(),
    })
}

pub const CSV_HEADER: &str = "index,keysoundStartMs,outputDelayMs,audibleMs,bufferFrames";

pub fn format_csv(records: &[PressRecord]) -> String {
    let mut text = String::from(CSV_HEADER);
    text.push('\n');
    for record in records {
        text.push_str(&format!(
            "{},{:.3},{:.3},{:.3},{}\n",
            record.index,
            record.keysound_start_us / 1000.0,
            record.output_delay_us / 1000.0,
            record.audible_us() / 1000.0,
            record.buffer_frames
        ));
    }
    text
}

/// A table of the presses' distributions in milliseconds, with the same row names as the web player's probe.
pub fn format_summary(records: &[PressRecord]) -> String {
    let rows: [(&str, Vec<f64>); 3] = [
        ("keysoundStart", records.iter().map(|record| record.keysound_start_us / 1000.0).collect()),
        ("outputDelay", records.iter().map(|record| record.output_delay_us / 1000.0).collect()),
        ("audible", records.iter().map(|record| record.audible_us() / 1000.0).collect()),
    ];
    let mut text = format!("{:<14}{:>5}{:>8}{:>8}{:>8}{:>8}{:>8}\n", "ms", "n", "min", "median", "p95", "max", "stdev");
    for (name, values) in rows {
        match summarize(&values) {
            Some(stats) => text.push_str(&format!(
                "{:<14}{:>5}{:>8.2}{:>8.2}{:>8.2}{:>8.2}{:>8.2}\n",
                name, stats.count, stats.min, stats.median, stats.p95, stats.max, stats.stdev
            )),
            None => text.push_str(&format!("{name:<14}{:>5}\n", 0)),
        }
    }
    text
}

/// Command-line options.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Options {
    pub list: bool,
    /// A case-insensitive part of the output device's name.
    pub device: Option<String>,
    /// A fixed buffer size in frames; the host's default otherwise.
    pub buffer: Option<u32>,
    /// Where to write the presses as CSV.
    pub out: Option<String>,
    /// Press this many times from inside the program, without a window, instead of waiting for Z.
    pub auto: Option<u32>,
}

pub const USAGE: &str = "usage: be-music-latency-native [--list] [--device <name>] [--buffer <frames>] [--auto <presses>] [--out <presses.csv>]";

fn positive(name: &str, text: String) -> Result<u32, String> {
    text.parse().ok().filter(|&value| value > 0).ok_or(format!("bad {name}: {text}"))
}

/// The gaps between automatic presses, in milliseconds: random, so the presses do not lock to the callback's
/// period. A xorshift generator keeps runs reproducible from the seed.
pub struct Gaps {
    state: u32,
    pub min_ms: u32,
    pub max_ms: u32,
}

impl Gaps {
    pub fn new(seed: u32, min_ms: u32, max_ms: u32) -> Self {
        Self { state: seed.max(1), min_ms, max_ms }
    }

    pub fn next_ms(&mut self) -> u32 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 17;
        self.state ^= self.state << 5;
        self.min_ms + self.state % (self.max_ms - self.min_ms + 1)
    }
}

pub fn parse_options<I: IntoIterator<Item = String>>(args: I) -> Result<Options, String> {
    let mut options = Options::default();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        let mut value = |name: &str| args.next().ok_or_else(|| format!("{name} needs a value"));
        match arg.as_str() {
            "--list" => options.list = true,
            "--device" => options.device = Some(value("--device")?),
            "--buffer" => options.buffer = Some(positive("--buffer", value("--buffer")?)?),
            "--auto" => options.auto = Some(positive("--auto", value("--auto")?)?),
            "--out" => options.out = Some(value("--out")?),
            _ => return Err(format!("unknown argument: {arg}")),
        }
    }
    Ok(options)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_passes_records_in_order_and_refuses_when_full() {
        let ring = Ring::<2, 2>::default();
        assert!(ring.push([1, 10]));
        assert!(ring.push([2, 20]));
        assert!(!ring.push([3, 30]));
        assert_eq!(ring.pop(), Some([1, 10]));
        assert!(ring.push([3, 30]));
        assert_eq!(ring.pop(), Some([2, 20]));
        assert_eq!(ring.pop(), Some([3, 30]));
        assert_eq!(ring.pop(), None);
    }

    #[test]
    fn ring_works_across_threads() {
        let ring = std::sync::Arc::new(Ring::<1, 8>::default());
        let producer = {
            let ring = ring.clone();
            std::thread::spawn(move || {
                for value in 0..1000 {
                    while !ring.push([value]) {
                        std::thread::yield_now();
                    }
                }
            })
        };
        let mut received = Vec::new();
        while received.len() < 1000 {
            match ring.pop() {
                Some([value]) => received.push(value),
                None => std::thread::yield_now(),
            }
        }
        producer.join().unwrap();
        assert_eq!(received, (0..1000).collect::<Vec<_>>());
    }

    #[test]
    fn click_is_one_millisecond() {
        assert_eq!(click_frames(48_000), 48);
        assert_eq!(click_frames(44_100), 45);
    }

    #[test]
    fn summarize_matches_the_jig_analysis() {
        let stats = summarize(&[30.0, 10.0, 20.0, 40.0]).unwrap();
        assert_eq!((stats.count, stats.min, stats.median, stats.max, stats.mean), (4, 10.0, 25.0, 40.0, 25.0));
        assert!((stats.p95 - 38.5).abs() < 1e-9);
        assert!((stats.stdev - 125f64.sqrt()).abs() < 1e-9);
        assert_eq!(summarize(&[]), None);
        assert_eq!(summarize(&[5.0]).unwrap().p99, 5.0);
    }

    fn record(index: u64, start: f64, delay: f64) -> PressRecord {
        PressRecord { index, keysound_start_us: start, output_delay_us: delay, buffer_frames: 512 }
    }

    #[test]
    fn csv_lists_each_press_in_milliseconds() {
        assert_eq!(
            format_csv(&[record(1, 1500.0, 10_250.0)]),
            "index,keysoundStartMs,outputDelayMs,audibleMs,bufferFrames\n1,1.500,10.250,11.750,512\n"
        );
    }

    #[test]
    fn summary_has_a_row_per_measure() {
        let summary = format_summary(&[record(1, 1000.0, 10_000.0), record(2, 3000.0, 10_000.0)]);
        let lines: Vec<&str> = summary.lines().collect();
        assert_eq!(lines[0], "ms                n     min  median     p95     max   stdev");
        assert_eq!(lines[1], "keysoundStart     2    1.00    2.00    2.90    3.00    1.00");
        assert_eq!(lines[3], "audible           2   11.00   12.00   12.90   13.00    1.00");
        assert_eq!(format_summary(&[]).lines().nth(1), Some("keysoundStart     0"));
    }

    #[test]
    fn options_parse() {
        let args = ["--device", "USB", "--buffer", "64", "--auto", "100", "--out", "a.csv"].map(String::from);
        assert_eq!(
            parse_options(args),
            Ok(Options {
                list: false,
                device: Some("USB".into()),
                buffer: Some(64),
                out: Some("a.csv".into()),
                auto: Some(100)
            })
        );
        assert!(parse_options(["--auto", "x"].map(String::from)).is_err());
        assert!(parse_options(["--buffer", "0"].map(String::from)).is_err());
        assert!(parse_options(["--device"].map(String::from)).is_err());
        assert!(parse_options(["--nope"].map(String::from)).is_err());
    }

    #[test]
    fn gaps_stay_in_range_and_repeat_from_the_seed() {
        let mut gaps = Gaps::new(7, 300, 800);
        let first: Vec<u32> = (0..200).map(|_| gaps.next_ms()).collect();
        assert!(first.iter().all(|gap| (300..=800).contains(gap)));
        assert!(first.iter().any(|&gap| gap < 400) && first.iter().any(|&gap| gap > 700));
        let mut again = Gaps::new(7, 300, 800);
        assert_eq!((0..200).map(|_| again.next_ms()).collect::<Vec<_>>(), first);
        assert_eq!(Gaps::new(0, 5, 5).next_ms(), 5);
    }
}
