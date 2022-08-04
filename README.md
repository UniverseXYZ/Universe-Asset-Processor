# Datascraper File Processor

### Features

- Resizes assets for web consumption
- Pulls assets from S3 bucket and processes in local temp folder

### Implementation Needs
- Rather than pulling assets from S3 bucket, must pull asset URLs from database
- Must store processed asset dimensions and web optimized asset URL and dimensions to database

### Getting started

- Ensure you are have Yarn or NPM installed on your machine
- Copy .env.sample to .env
- Upload assets to your preferred S3 folder and update .env configuration
- Ensure you have ffmpeg installed
- Provide path of ffmpeg in .env
- Run the following commands on your local environment

```
yarn
```
```
yarn dev
```

### Processed Data

This is an example result object that is returned for each processed asset from webOptimizer function. 

- It returns the original asset's width, height, duration, and optimized asset
- If the original asset is a video, the optimized asset is an image thumbnail

```
{
  width: 1280,
  height: 720,
  duration: 51.233333,
  web: {
    width: 600,
    height: 338,
    path: 'temp/75e66c9c14faf76544ef2f299300899cb7ed8b4f1c5e0c9e.jpg'
  },
  mimeType: { mime: 'video/mp4', contentType: 'video', ext: 'mp4' }
```