// 将 FrameBuf 流式喂给 ffmpeg rawvideo 管道，输出 mp4。
import { spawn } from "node:child_process";
import type { FrameBuf } from "./framebuf.ts";

export interface EncodeOpts {
  width: number; height: number; fps: number;
  outPath: string;
  /** 附加音频文件路径（会与视频流合成） */
  audioPath?: string;
  crf?: number;
}

export async function encodeFrames(frames: AsyncIterable<FrameBuf> | Iterable<FrameBuf>, opts: EncodeOpts): Promise<void> {
  const args = [
    "-y", "-f", "rawvideo", "-pix_fmt", "rgba",
    "-s", `${opts.width}x${opts.height}`, "-r", String(opts.fps), "-i", "pipe:0",
  ];
  if (opts.audioPath) {
    args.push("-i", opts.audioPath, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-shortest");
  }
  args.push(
    "-c:v", "libx264", "-preset", "medium", "-crf", String(opts.crf ?? 18),
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    opts.outPath,
  );
  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });
  let closed = false;
  const writeFrame = (fb: FrameBuf) => new Promise<void>((res, rej) => {
    if (closed || ff.stdin.destroyed) return res();
    ff.stdin.write(Buffer.from(fb.data.buffer, fb.data.byteOffset, fb.data.byteLength), (err: Error|null) => err ? rej(err) : res());
  });

  const iter = (frames as AsyncIterable<FrameBuf>)[Symbol.asyncIterator]
    ? (frames as AsyncIterable<FrameBuf>)[Symbol.asyncIterator]()
    : (frames as Iterable<FrameBuf>)[Symbol.iterator]();

  for (;;) {
    const { value, done } = await iter.next();
    if (done) break;
    await writeFrame(value);
  }
  await new Promise<void>((res) => ff.stdin.end(res));
  await new Promise<void>((res, rej) => {
    ff.on("close", (code) => code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`)));
  });
  closed = true;
}
