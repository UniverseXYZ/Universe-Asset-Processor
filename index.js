
const fs = require('fs');
const path = require('path');
const jimp = require('jimp');
const { videoResize } = require('node-video-resize');
const getMediaDimensions = require('get-media-dimensions');
const { promisify } = require('util');
const { Duplex } = require('stream');
const gifResize = require('@gumlet/gif-resize');

const compressor = async (file) => {
  return new Promise(resolve => {
    const input = path.join(__dirname, `./test-images/${ file }`);
    const output = path.join(__dirname, `./test-output/${ file }`);
    const write = fs.createWriteStream(output);
    console.log('PROCESSING FILE: ', file);

    const fileType = file.split('.')[1];
    if (fileType === 'gif') {
      const buf = fs.readFileSync(input);
      gifResize({
        width: 600,
        optimizationLevel: 3
      })(buf).then(async data => {
        const stream = new Duplex();
        stream.push(data);
        stream.push(null);
        console.log("'WROTE GIF'");
        await stream.pipe(write);
        resolve();
      });

    } else if (fileType === 'mp4') {
      getMediaDimensions(input, 'video').then(dimensions => {
        const width = 600;
        const height = Math.round((width / dimensions.width) * dimensions.height);
        console.log(width, height);
        videoResize({
          inputPath: input,
          outputPath: output,
          format: 'mp4',
          size: `${ width }x${ height }`
        }).then(() => {
          console.log('WROTE VIDEO');
          resolve();
        })
      });
    } else {
      const read = promisify(fs.readFile);

      read(input)
      .then((result) => {
          return jimp.read(result);
      })
      .then((img) => {
          const r = img.resize(600, jimp.AUTO);
          const b = promisify(r.getBuffer.bind(r));
          return b(jimp.AUTO);
      })
      .then((buff) => {
          const stream = new Duplex();
          stream.push(buff);
          stream.push(null);
          return stream;
      })
      .then((stream) => {
          return stream.pipe(write);
      })
      .then((data) => {
        console.log('WROTE IMAGE');
        resolve();
      })
      .catch((err) => {
          console.log('error', err);
      });
    }
  });
}

const filename = 'Rob Hill - Commonalities - 154.jpeg'
compressor(filename)