const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile, exec } = require("child_process");

const app = express();
const PORT = 3000;

// Bật CORS để tránh mọi lỗi chặn kết nối từ trình duyệt
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});

const INPUT_DIR = path.join(__dirname, "input");
const OUTPUT_DIR = path.join(__dirname, "output");
const AD_BREAK = 20;
const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;
const TARGET_FPS = 30;
const TARGET_AUDIO_RATE = 48000;
const TARGET_AUDIO_CHANNELS = 2;
const VIDEO_BITRATE = "2500k";
const AUDIO_BITRATE = "128k";

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const ads = {
  hanoi: path.join(INPUT_DIR, "ad_video1.mp4"),
  danang: path.join(INPUT_DIR, "ad_video2.mp4")
};

app.use(express.static(__dirname));
app.use("/output", express.static(OUTPUT_DIR));

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, (error, stdout, stderr) => {
      if (error) {
        console.error("\n===== FFmpeg ERROR =====");
        console.error(stderr);
        console.error("========================\n");
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function getDuration(file) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
      (error, stdout, stderr) => {
        if (error) {
          console.error(stderr);
          reject(error);
          return;
        }
        const duration = Number.parseFloat(stdout.trim());
        if (!Number.isFinite(duration)) {
          reject(new Error("Không đọc được thời lượng video."));
          return;
        }
        resolve(duration);
      }
    );
  });
}

const videoFilter = `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${TARGET_FPS},format=yuv420p`;

app.get("/api/stream", async (req, res) => {
  const region = String(req.query.region || "").toLowerCase();
  
  if (!ads[region]) {
    return res.status(400).json({ error: "Khu vực không hợp lệ. Chọn hanoi hoặc danang." });
  }

  const mainVideo = path.join(INPUT_DIR, "main_video.mp4");
  const adVideo = ads[region];

  if (!fs.existsSync(mainVideo) || !fs.existsSync(adVideo)) {
    return res.status(500).json({ error: "Không tìm thấy file video đầu vào trong thư mục input." });
  }

  const workDir = path.join(OUTPUT_DIR, region);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  const mainPart1 = path.join(workDir, "main_part1.mp4");
  const mainPart2 = path.join(workDir, "main_part2.mp4");
  const adPart = path.join(workDir, "ad.mp4");
  const joined = path.join(workDir, "joined.mp4");
  const playlist = path.join(workDir, "stream.m3u8");
  const concatFile = path.join(workDir, "concat.txt");

  try {
    const mainDuration = await getDuration(mainVideo);
    if (mainDuration <= AD_BREAK) {
      return res.status(400).json({ error: `Main video phải dài hơn ${AD_BREAK} giây.` });
    }

    // 1. Cắt Main Phần 1 (0 -> 20s)
    await runFFmpeg([
      "-y", "-i", mainVideo, "-t", String(AD_BREAK),
      "-vf", videoFilter, "-c:v", "libx264", "-preset", "veryfast", "-b:v", VIDEO_BITRATE,
      "-r", String(TARGET_FPS), "-pix_fmt", "yuv420p", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
      "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", String(TARGET_AUDIO_RATE), "-ac", String(TARGET_AUDIO_CHANNELS),
      "-movflags", "+faststart", mainPart1
    ]);

    // 2. Cắt Main Phần 2 (20s -> Hết)
    await runFFmpeg([
      "-y", "-ss", String(AD_BREAK), "-i", mainVideo,
      "-vf", videoFilter, "-c:v", "libx264", "-preset", "veryfast", "-b:v", VIDEO_BITRATE,
      "-r", String(TARGET_FPS), "-pix_fmt", "yuv420p", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
      "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", String(TARGET_AUDIO_RATE), "-ac", String(TARGET_AUDIO_CHANNELS),
      "-movflags", "+faststart", mainPart2
    ]);

    // 3. Chuẩn hóa Quảng cáo
    await runFFmpeg([
      "-y", "-i", adVideo,
      "-vf", videoFilter, "-c:v", "libx264", "-preset", "veryfast", "-b:v", VIDEO_BITRATE,
      "-r", String(TARGET_FPS), "-pix_fmt", "yuv420p", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
      "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", String(TARGET_AUDIO_RATE), "-ac", String(TARGET_AUDIO_CHANNELS),
      "-movflags", "+faststart", adPart
    ]);

    // 4. Tạo file cấu hình concat
    fs.writeFileSync(
      concatFile,
      `file '${mainPart1.replace(/\\/g, "/")}'\n` +
      `file '${adPart.replace(/\\/g, "/")}'\n` +
      `file '${mainPart2.replace(/\\/g, "/")}'\n`
    );

    // 5. Ghép nối các phần lại với nhau
    await runFFmpeg([
      "-y", "-f", "concat", "-safe", "0", "-i", concatFile,
      "-c", "copy", "-movflags", "+faststart", joined
    ]);

    // 6. Đóng gói thành định dạng HLS
    await runFFmpeg([
      "-y", "-i", joined, "-c", "copy", "-start_number", "0",
      "-hls_time", "4", "-hls_list_size", "0",
      "-hls_segment_filename", path.join(workDir, "segment_%03d.ts"),
      "-f", "hls", playlist
    ]);

    res.json({
      success: true,
      region: region,
      ad: region === "hanoi" ? "ad_video1.mp4" : "ad_video2.mp4",
      adBreak: `${AD_BREAK} giây`,
      mainDuration: `${mainDuration.toFixed(2)} giây`,
      playlist: `/output/${region}/stream.m3u8`
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "FFmpeg xử lý thất bại. Kiểm tra log trên Terminal." });
  }
});

app.listen(PORT, () => {
  console.log(`SSAI HLS Server đang chạy tại cổng ${PORT}`);{PORT}`);
  
  // Tự động mở trình duyệt trỏ thẳng vào localhost khi chạy server
  const url = `http://localhost:${PORT}`;
  const startCommand = process.platform === "win32" ? `start ${url}` : process.platform === "darwin" ? `open ${url}` : `xdg-open ${url}`;
  exec(startCommand);
});