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
  width: 2000,
  height: 2000,
  duration: 17.666667,
  web: {
    width: 600,
    height: 600,
    path: 'temp/a6180c8f8225cbee7d22f32ab78c737af997be8db6276e1e.jpg'
  }
}
```