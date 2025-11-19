# Video Trimmer - Batch Video Trimming Tool

A simple, creator-friendly tool that lets you upload multiple videos and instantly trim a few seconds from the beginning and end of each video. Process everything in order, preview individual videos, and download them all as a ZIP file.

## Features

- 🎬 **Batch Upload**: Drag and drop multiple videos at once
- ✂️ **Easy Trimming**: Set trim duration for start and end of videos
- 👀 **Preview**: Watch processed videos before downloading
- 📦 **Auto ZIP**: Automatically bundles all processed videos into a single ZIP file
- ⚡ **Fast Processing**: Sequential processing ensures consistent quality
- 🎨 **Modern UI**: Clean, intuitive interface that anyone can use

## Prerequisites

- Node.js (v14 or higher)
- FFmpeg installed on your system

### Installing FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**Windows:**
Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH

## Installation

1. Clone or download this repository
2. Install dependencies:
```bash
npm run install-all
```

## Running the Application

Start both the server and client:
```bash
npm run dev
```

Or run them separately:

**Terminal 1 (Server):**
```bash
npm run server
```

**Terminal 2 (Client):**
```bash
npm run client
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## Usage

1. **Upload Videos**: Drag and drop video files into the upload area, or click to browse
2. **Set Trim Duration**: Enter how many seconds to trim from the start and end
3. **Process**: Click the "Trim Videos" button to start processing
4. **Preview**: Watch your trimmed videos in the preview area
5. **Download**: Download individual videos or get all videos in a ZIP file

## Supported Video Formats

- MP4
- MOV
- AVI
- MKV
- WebM

## Technical Details

- **Frontend**: React with modern CSS
- **Backend**: Node.js/Express
- **Video Processing**: FFmpeg (via fluent-ffmpeg)
- **File Handling**: Multer for uploads, Archiver for ZIP creation

## Notes

- Maximum file size: 500MB per video
- Maximum 20 videos per batch
- Videos are processed sequentially to maintain quality
- Processed files are stored temporarily and can be cleaned up

## License

MIT

