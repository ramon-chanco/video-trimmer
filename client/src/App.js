import React, { useState, useCallback } from 'react';
import './App.css';
import axios from 'axios';

// Use relative API path in production (Railway/Vercel), localhost in development
const API_BASE = process.env.NODE_ENV === 'production' 
  ? '' 
  : (process.env.REACT_APP_API_URL || 'http://localhost:3001');

function App() {
  const [files, setFiles] = useState([]);
  const [trimStart, setTrimStart] = useState(0.4);
  const [trimEnd, setTrimEnd] = useState(0.4);
  const [outputBaseName, setOutputBaseName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedFiles, setProcessedFiles] = useState([]);
  const [zipUrl, setZipUrl] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files).filter(file => 
      file.type.startsWith('video/')
    );
    
    if (droppedFiles.length > 0) {
      setFiles(prev => [...prev, ...droppedFiles]);
    }
  }, []);

  const handleFileSelect = useCallback((e) => {
    const selectedFiles = Array.from(e.target.files).filter(file => 
      file.type.startsWith('video/')
    );
    
    if (selectedFiles.length > 0) {
      setFiles(prev => [...prev, ...selectedFiles]);
    }
  }, []);

  const removeFile = useCallback((index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearQueue = useCallback(() => {
    setFiles([]);
    setProcessedFiles([]);
    setZipUrl(null);
  }, []);

  const handleUploadAndProcess = async () => {
    if (files.length === 0) return;

    setIsProcessing(true);
    setProcessedFiles([]);
    setZipUrl(null);
    setProgress({ current: 0, total: files.length });

    try {
      // Upload files
      const formData = new FormData();
      files.forEach(file => {
        formData.append('videos', file);
      });

      const uploadResponse = await axios.post(`${API_BASE}/api/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const newSessionId = uploadResponse.data.sessionId;

      // Process videos
      const processResponse = await axios.post(`${API_BASE}/api/process`, {
        sessionId: newSessionId,
        files: uploadResponse.data.files,
        trimStart: trimStart,
        trimEnd: trimEnd,
        outputBaseName: outputBaseName.trim() // Server will use 'trimmed' if empty
      });

      setProcessedFiles(processResponse.data.files.map(file => ({
        ...file,
        fullUrl: `${API_BASE}${file.url}`
      })));

      // Create ZIP
      const zipResponse = await axios.post(`${API_BASE}/api/create-zip`, {
        sessionId: newSessionId
      });

      setZipUrl(`${API_BASE}${zipResponse.data.zipUrl}`);
      setProgress({ current: files.length, total: files.length });
    } catch (error) {
      console.error('Error processing videos:', error);
      alert('Error processing videos: ' + (error.response?.data?.error || error.message));
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadFile = async (url, filename) => {
    try {
      // Fetch the file as a blob to force download instead of opening in browser
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the blob URL
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download error:', error);
      // Fallback to direct download
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="App">
      <div className="container">
        {/* Header */}
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">✂️</div>
            <div>
              <h1 className="logo-title">FrameCut AI</h1>
              <p className="logo-subtitle">Video Processor & Trimming</p>
            </div>
          </div>
          <div className="header-controls">
            <div className="control-group">
              <label htmlFor="outputName">OUTPUT FILENAME</label>
              <input
                id="outputName"
                type="text"
                placeholder="e.g. Coverstar"
                value={outputBaseName}
                onChange={(e) => setOutputBaseName(e.target.value)}
                disabled={isProcessing}
                className="output-name-input"
              />
            </div>
            <div className="control-group">
              <label htmlFor="trimStart">START CUT</label>
              <div className="trim-input-wrapper">
                <input
                  id="trimStart"
                  type="number"
                  min="0"
                  step="0.01"
                  value={trimStart}
                  onChange={(e) => setTrimStart(parseFloat(e.target.value) || 0)}
                  disabled={isProcessing}
                  className="trim-input"
                />
                <span className="unit">s</span>
              </div>
            </div>
            <div className="control-group">
              <label htmlFor="trimEnd">END CUT</label>
              <div className="trim-input-wrapper">
                <input
                  id="trimEnd"
                  type="number"
                  min="0"
                  step="0.01"
                  value={trimEnd}
                  onChange={(e) => setTrimEnd(parseFloat(e.target.value) || 0)}
                  disabled={isProcessing}
                  className="trim-input"
                />
                <span className="unit">s</span>
              </div>
            </div>
            <button
              className="process-all-btn"
              onClick={handleUploadAndProcess}
              disabled={isProcessing || files.length === 0}
            >
              <span className="btn-icon">✂️</span>
              Process All
            </button>
          </div>
        </header>

        {/* Progress */}
        {isProcessing && (
          <div className="progress-section">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
            <p className="progress-text">Processing {progress.current} of {progress.total} videos...</p>
          </div>
        )}

        {/* Split Layout */}
        <div className="split-layout">
          {/* Left Side - Uploaded Videos */}
          <div className="left-panel">
            <div className="panel-header">
              <h2 className="panel-title">Uploaded Videos <span className="queue-count">{files.length}</span></h2>
              {files.length > 0 && (
                <button className="clear-queue-btn" onClick={clearQueue}>
                  <span className="btn-icon">🗑️</span>
                  Clear
                </button>
              )}
            </div>

            {/* Video Cards */}
            {files.length > 0 ? (
              <div className="videos-grid">
                {files.map((file, index) => {
                  const fileUrl = URL.createObjectURL(file);
                  return (
                    <div key={index} className="video-card">
                      <div className="video-player-container">
                        <video
                          src={fileUrl}
                          controls
                          className="video-preview"
                          preload="metadata"
                        />
                      </div>
                      <div className="video-details">
                        <div className="video-filename">{file.name}</div>
                        <div className="video-meta">
                          <span className="file-size">{formatFileSize(file.size)}</span>
                        </div>
                        <button
                          className="remove-video-btn"
                          onClick={() => removeFile(index)}
                          aria-label="Remove video"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className={`add-videos-zone ${isDragging ? 'dragging' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  multiple
                  accept="video/*"
                  onChange={handleFileSelect}
                  className="file-input"
                  id="file-input"
                />
                <label htmlFor="file-input" className="add-videos-label">
                  <div className="upload-icon">📤</div>
                  <div>
                    <div className="add-videos-text">Drop videos here</div>
                    <div className="add-videos-subtext">or click to browse</div>
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* Right Side - Trimmed Videos */}
          <div className="right-panel">
            <div className="panel-header">
              <h2 className="panel-title">Trimmed Videos <span className="queue-count">{processedFiles.length}</span></h2>
            </div>

            {processedFiles.length > 0 ? (
              <div className="processed-videos-grid">
                {processedFiles.map((file, index) => (
                  <div key={index} className="processed-video-card">
                    <video
                      src={file.fullUrl}
                      controls
                      className="processed-video-preview"
                    />
                    <div className="processed-video-info">
                      <p className="processed-video-name">{file.fileName}</p>
                      <button
                        className="download-btn"
                        onClick={() => downloadFile(file.fullUrl, file.fileName)}
                      >
                        Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">✂️</div>
                <p className="empty-text">Processed videos will appear here</p>
              </div>
            )}

            {/* ZIP Download */}
            {zipUrl && (
              <div className="zip-section">
                <div className="zip-card">
                  <h3>✨ All videos ready!</h3>
                  <p>Download all trimmed videos as a ZIP file</p>
                  <button
                    className="zip-btn"
                    onClick={async () => {
                      const zipFilename = `${outputBaseName || 'trimmed'}_all.zip`;
                      await downloadFile(zipUrl, zipFilename);
                    }}
                  >
                    Download All ({processedFiles.length} videos)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
