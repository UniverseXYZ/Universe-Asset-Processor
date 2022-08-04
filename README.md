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