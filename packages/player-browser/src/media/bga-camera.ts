/**
 * A camera picture for the BGA frame: the `MediaStream` the host captured (`getUserMedia`), played in a muted
 * `<video>` and wrapped in a Pixi `VideoSource`, as a chart's video BGA is. The play scenes draw its texture in place of
 * the chart's BGA (`renderBGA`, the beatoraja BGA layer), and a Be-Music Skin that composites the BGA itself gets
 * {@link BGACameraFeed.image}.
 *
 * The feed only shows the stream. The host owns it: it opens the camera, stops its tracks, and drops the feed when the
 * camera goes away. Nothing here sends the picture anywhere; it reaches only the canvas (and so a Capture recording of
 * the canvas).
 */

import { groupD8, Texture, VideoSource } from 'pixi.js';
import { fitBGACameraRect } from './bga-camera-fit.ts';

/** The side of the square picture a Canvas skin gets, the BMS BGA canvas. */
const SKIN_IMAGE_SIZE = 256;

export interface BGACameraFeedOptions {
  /** Flip the picture left to right, as a mirror shows it. */
  readonly mirror?: boolean;
}

export class BGACameraFeed {
  public readonly stream: MediaStream;
  public readonly video: HTMLVideoElement;
  /** Flip the picture left to right. Applies from the next frame. */
  public mirror: boolean;
  private source: VideoSource | undefined;
  private plain: Texture | undefined;
  private mirrored: Texture | undefined;
  private skinCanvas: HTMLCanvasElement | undefined;
  private disposed = false;

  public constructor(stream: MediaStream, options: BGACameraFeedOptions = {}) {
    this.stream = stream;
    this.mirror = options.mirror === true;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = stream;
    this.video = video;
    void video.play().catch(() => {
      // The scene shows the camera after a click or key press, so autoplay is allowed; if it is not, the frame stays
      // black until `texture` tries to play it again.
    });
  }

  /**
   * The texture to draw this frame, mirrored when {@link mirror} is set, or `undefined` until the camera has a frame.
   * WebGPU cannot upload a video with no decoded frame, so the source is made only once one is there.
   */
  public texture(): Texture | undefined {
    if (this.disposed) return undefined;
    const video = this.video;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.videoHeight === 0) {
      if (video.paused) void video.play().catch(() => {});
      return undefined;
    }
    if (this.source === undefined) {
      this.source = new VideoSource({ resource: video, autoPlay: true, autoLoad: true });
      this.source.label = 'bga/camera';
      this.plain = new Texture({ source: this.source, label: 'bga/camera' });
      this.mirrored = new Texture({ source: this.source, rotate: groupD8.MIRROR_HORIZONTAL, label: 'bga/camera' });
    }
    // A camera can change its size (a phone turned, another resolution picked); the textures follow the source.
    if (this.source.width !== video.videoWidth || this.source.height !== video.videoHeight) {
      this.source.resize(video.videoWidth, video.videoHeight);
    }
    if (video.paused) void video.play().catch(() => {});
    return this.mirror ? this.mirrored : this.plain;
  }

  /**
   * The picture for a Be-Music Skin that composites the BGA itself: a 256x256 canvas with the camera fitted in, black
   * around it and mirrored when {@link mirror} is set, redrawn on each call. `undefined` until the camera has a frame.
   */
  public image(): HTMLCanvasElement | undefined {
    if (this.disposed) return undefined;
    const video = this.video;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) return undefined;
    const canvas = (this.skinCanvas ??= Object.assign(document.createElement('canvas'), {
      width: SKIN_IMAGE_SIZE,
      height: SKIN_IMAGE_SIZE,
    }));
    const context = canvas.getContext('2d');
    if (context === null) return undefined;
    const placed = fitBGACameraRect(video.videoWidth, video.videoHeight, {
      x: 0,
      y: 0,
      w: SKIN_IMAGE_SIZE,
      h: SKIN_IMAGE_SIZE,
    });
    context.save();
    context.fillStyle = '#000';
    context.fillRect(0, 0, SKIN_IMAGE_SIZE, SKIN_IMAGE_SIZE);
    if (this.mirror) {
      context.translate(SKIN_IMAGE_SIZE, 0);
      context.scale(-1, 1);
    }
    try {
      context.drawImage(video, placed.x, placed.y, placed.w, placed.h);
    } catch {
      // No frame to copy yet: the black canvas shows until the next draw.
    }
    context.restore();
    return canvas;
  }

  /** Stops showing the stream. The host stops the stream's tracks itself. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.video.pause();
    this.video.srcObject = null;
    const { plain, mirrored, source } = this;
    this.source = undefined;
    this.plain = undefined;
    this.mirrored = undefined;
    // A BGA sprite may still hold the texture until the scene's next frame draws without it, so the GPU side goes a
    // couple of frames later. Destroying the source also drops its video hooks.
    const release = (): void => {
      plain?.destroy(false);
      mirrored?.destroy(false);
      source?.destroy();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(release));
    else setTimeout(release, 50);
  }
}
