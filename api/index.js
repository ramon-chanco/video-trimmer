const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Use /tmp for Vercel (writable directory)
const TMP_DIR = '/tmp';
const UPLOAD_DIR = path.join(TMP_DIR, 'uploads');
const OUTPUT_DIR = path.join(TMP_DIR, 'output');
const ZIP_DIR = path.join(TMP_DIR, 'zips');

[UPLOAD_DIR, OUTPUT_DIR, ZIP_DIR].forEach(dir => {
  fs.ensureDirSync(dir);
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|mov|avi|mkv|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

// Serve files directly (Vercel serverless doesn't support static files from /tmp)
app.get('/api/output/:sessionId/:filename', async (req, res) => {
  try {
    const { sessionId, filename } = req.params;
    const filePath = path.join(OUTPUT_DIR, sessionId, filename);
    
    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const stats = await fs.stat(filePath);
    const fileSize = stats.size;
    const range = req.headers.range;
    
    // Support range requests for video streaming
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      });
      file.pipe(res);
    } else {
      // Full file download
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    }
  } catch (error) {
    console.error('File serve error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/zips/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(ZIP_DIR, filename);
    
    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('ZIP serve error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Upload videos endpoint
app.post('/api/upload', upload.array('videos', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const sessionId = uuidv4();
    const sessionDir = path.join(OUTPUT_DIR, sessionId);
    await fs.ensureDir(sessionDir);

    const files = req.files.map(file => ({
      originalName: file.originalname,
      uploadPath: file.path,
      sessionId: sessionId
    }));

    res.json({
      sessionId: sessionId,
      files: files.map(f => ({
        originalName: f.originalName,
        uploadPath: f.uploadPath
      }))
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Process video endpoint
app.post('/api/process', async (req, res) => {
  const { sessionId, files, trimStart, trimEnd, outputBaseName } = req.body;

  if (!sessionId || !files || files.length === 0) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const trimStartSeconds = parseFloat(trimStart) || 0;
  const trimEndSeconds = parseFloat(trimEnd) || 0;
  const trimmedBaseName = outputBaseName ? outputBaseName.trim() : '';
  const baseName = trimmedBaseName || 'trimmed';
  console.log(`Processing with baseName: "${baseName}" (input was: "${outputBaseName}")`);

  try {
    const sessionDir = path.join(OUTPUT_DIR, sessionId);
    const processedFiles = [];

    // Process files sequentially
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const uploadPath = file.uploadPath;
      
      if (!await fs.pathExists(uploadPath)) {
        console.error(`File not found: ${uploadPath}`);
        continue;
      }

      const originalExt = path.extname(file.originalName) || '.mp4';
      const outputFileName = `${baseName}_${i + 1}${originalExt}`;
      const outputPath = path.join(sessionDir, outputFileName);
      console.log(`Output filename: ${outputFileName}`);

      // Get video duration first
      const videoDuration = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(uploadPath, (err, metadata) => {
          if (err) {
            reject(err);
          } else {
            resolve(metadata.format.duration);
          }
        });
      });

      // Calculate end time (absolute time, not duration)
      const endTime = videoDuration - trimEndSeconds;
      
      if (endTime <= trimStartSeconds) {
        console.error(`Video ${file.originalName} is too short to trim`);
        continue;
      }

      await new Promise((resolve, reject) => {
        // Frame-accurate trimming with high-quality re-encoding
        // Both -ss and -to are placed AFTER input to ensure accurate timing relative to original video
        // This eliminates timing mismatches that cause black frames at start/end
        // CRF 20 provides visually lossless quality while maintaining reasonable speed
        
        ffmpeg(uploadPath)
          .outputOptions([
            `-ss ${trimStartSeconds}`,   // Start time (after input - accurate relative to original)
            `-to ${endTime}`,            // End time (after input - accurate relative to original)
            '-c:v libx264',              // H.264 video codec
            '-crf 20',                   // High quality (visually lossless, 18-23 range)
            '-preset medium',            // Balance between speed and compression
            '-c:a aac',                  // AAC audio codec
            '-b:a 192k',                 // High quality audio bitrate
            '-movflags +faststart',      // Web optimization for streaming
            '-pix_fmt yuv420p',         // Ensure compatibility
            '-copyts',                   // Preserve original timestamps
            '-fflags +genpts',           // Regenerate presentation timestamps
            '-avoid_negative_ts make_zero' // Handle negative timestamps
          ])
          .on('start', (commandLine) => {
            console.log(`Processing: ${file.originalName} -> ${outputFileName}`);
          })
          .on('progress', (progress) => {
            console.log(`Progress: ${progress.percent}%`);
          })
          .on('end', () => {
            console.log(`Finished: ${file.originalName} -> ${outputFileName}`);
            resolve();
          })
          .on('error', (err) => {
            console.error(`Error processing ${file.originalName}:`, err);
            reject(err);
          })
          .save(outputPath);
      });

      processedFiles.push({
        originalName: file.originalName,
        fileName: outputFileName,
        url: `/api/output/${sessionId}/${outputFileName}`
      });
    }

    res.json({
      sessionId: sessionId,
      files: processedFiles
    });
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create ZIP endpoint
app.post('/api/create-zip', async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  try {
    const sessionDir = path.join(OUTPUT_DIR, sessionId);
    const zipFileName = `trimmed_videos_${sessionId}.zip`;
    const zipPath = path.join(ZIP_DIR, zipFileName);

    if (!await fs.pathExists(sessionDir)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on('close', () => {
        res.json({
          zipUrl: `/api/zips/${zipFileName}`,
          fileName: zipFileName
        });
        resolve();
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);
      archive.directory(sessionDir, false);
      archive.finalize();
    });
  } catch (error) {
    console.error('ZIP creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cleanup endpoint
app.delete('/api/cleanup/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const sessionDir = path.join(OUTPUT_DIR, sessionId);
    await fs.remove(sessionDir);
    res.json({ message: 'Cleaned up' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export for Vercel
module.exports = app;

