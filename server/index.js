const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Ensure directories exist
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'output');
const ZIP_DIR = path.join(__dirname, 'zips');

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

// Serve static files
app.use('/output', express.static(OUTPUT_DIR));
app.use('/zips', express.static(ZIP_DIR));

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
  // Sanitize and use the base name, default to 'trimmed' if empty or not provided
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

      // Use smart naming convention - preserve original file extension
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

      // Calculate new duration
      const newDuration = videoDuration - trimStartSeconds - trimEndSeconds;
      
      if (newDuration <= 0) {
        console.error(`Video ${file.originalName} is too short to trim`);
        continue;
      }

      await new Promise((resolve, reject) => {
        // Copy streams to preserve original resolution, format, and quality
        // Only trim, no re-encoding
        ffmpeg(uploadPath)
          .setStartTime(trimStartSeconds)
          .setDuration(newDuration)
          .outputOptions([
            '-c copy',                    // Copy both video and audio streams (no re-encoding)
            '-avoid_negative_ts make_zero', // Handle timestamp issues
            '-movflags +faststart'       // Web optimization
          ])
          .on('start', (commandLine) => {
            console.log(`Processing: ${file.originalName} -> ${outputFileName}`);
            console.log(`Command: ${commandLine}`);
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
        url: `/output/${sessionId}/${outputFileName}`
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
          zipUrl: `/zips/${zipFileName}`,
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

// Cleanup endpoint (optional)
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

// Serve React app in production
if (process.env.NODE_ENV === 'production') {
  const clientBuildPath = path.join(__dirname, '../client/build');
  
  // Serve static files from React build
  app.use(express.static(clientBuildPath));
  
  // Handle React routing - return index.html for all non-API routes
  app.get('*', (req, res) => {
    // Don't serve index.html for API routes
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API route not found' });
    }
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (process.env.NODE_ENV === 'production') {
    console.log('Production mode: Serving React app');
  }
});

