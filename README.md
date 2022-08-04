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
PROCESSING FILE:  test-images/Jason Mitchell - Moon 001 - 3.jpeg
========== PROCESSED JPG ==========
{
  width: 3456,
  height: 5184,
  web: {
    width: 600,
    height: 900,
    path: 'temp/06db489f84e3bebbe0d029000fe2c7c80a4e1f542d39a981.jpg',
    mimeType: { mime: 'image/jpg', contentType: 'image', ext: 'jpg' }
  },
  mimeType: { mime: 'image/jpg', contentType: 'image', ext: 'jpg' }
}

PROCESSING FILE:  test-images/Kevin Rupp - Will Check Grammar For Food - 63.mp4
========== PROCESSED MP4 ==========
{
  width: 1280,
  height: 720,
  duration: 51.233333,
  web: {
    width: 600,
    height: 338,
    path: 'temp/47583cd074df356a45df28a1813dd7be7f0abe6a4c4a478a.jpg',
    mimeType: { mime: 'image/jpg', contentType: 'image', ext: 'jpg' }
  },
  mimeType: { mime: 'video/mp4', contentType: 'video', ext: 'mp4' }
}

PROCESSING FILE:  test-images/Megan Glenna - Late Night Validation - 168.gif
========== PROCESSED GIF ==========
{
  width: 1440,
  height: 1440,
  web: {
    width: 600,
    height: 600,
    path: 'temp/8d93a2ce8cbd8246d35afdae34ddb16bf87b1d6fddd993c8.webp',
    mimeType: { mime: 'image/webp', contentType: 'image', ext: 'webp' }
  },
  mimeType: { mime: 'image/gif', contentType: 'image', ext: 'gif' }
}
```