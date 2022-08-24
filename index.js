"use strict";

const stream = require("stream"),
    sharp = require("sharp"),
    mime = require("mime/lite"),
    AWS = require("aws-sdk"),
    extractFrames = require("ffmpeg-extract-frames"),
    fs = require("fs"),
    crypto = require("crypto"),
    dotenv = require("dotenv");
    
const fsPromise = fs.promises;
dotenv.config();
// aws config
AWS.config.update({
    accessKeyId: process.env.AWS_KEY,
    secretAccessKey: process.env.AWS_SECRET,
});

const s3 = new AWS.S3();
const sizes = [
  "360w", // thumb without height restriction
  "480w",
  "640w",
  "1280w", // largest web image
];

exports.handler = async (event) => {
    // read key from querystring
    let key = event.queryStringParameters.key;
    const key_components = key.split("/");

    // extract file name
    const file = key_components.pop();
    // extract file size
    const size = key_components.pop();

    if (sizes.indexOf(size) === -1) {
        return {
            statusCode: 404,
            body: JSON.stringify("Invalid output size."),
        };
    }

    var params = {};

    // process size from given string
    if (size.slice(-1) == "w") {
        // extract width only
        params.width = parseInt(size.slice(0, -1), 10);
    } else if (size.slice(-1) == "h") {
        // extract height only
        params.height = parseInt(size.slice(0, -1), 10);
    } else {
        // extract width & height
        var size_components = size.split("x");

        // if there aren't 2 values, stop here
        if (size_components.length != 2)
            return {
                statusCode: 404,
                body: JSON.stringify("Invalid image size."),
            };

        params = {
            width: parseInt(size_components[0], 10),
            height: parseInt(size_components[1], 10),
        };

        if (isNaN(params.width) || isNaN(params.height))
            return {
                statusCode: 404,
                body: JSON.stringify("Invalid image size."),
            };
    }

    // 1. Check media type
    const extension = file.split(".").pop();
    let isVideo = false
    if (['mp4', 'mov'].find(ext => ext === extension)) {
      key = key.replace(file, 'thumbnail.jpg');
      isVideo = true;
    }

    // 2. Check if image exists

    // check if target key already exists
    var target = null;
    await s3
        .headObject({
            Bucket: process.env.IMAGES_BUCKET,
            Key: key,
        })
        .promise()
        .then((res) => (target = res))
        .catch(() => console.log("File doesn't exist."));

    // if file exists and the request is not forced, stop here
    const forced = typeof event.queryStringParameters.force !== "undefined";
    if (target != null && !forced) {
        // 301 redirect to existing image
        return {
            statusCode: 301,
            headers: {
                location: process.env.CDN_URL + "/" + key,
            },
            body: "",
        };
    }

    // add file name back to get source key
    key_components.push(file);
    if (isVideo) {
      return await processVideo(key_components, params, key, extension);
    } else {
      const imageUrl = key_components.join("/");
      return await processS3Image(imageUrl, params, key, extension);
    }
};

const processVideo = async (key_components, params, key, extension) => {
  try {
    const tempFile = await temporaryStore(key_components.join('/'), extension);

    const tempFrame = process.env.FILESYSTEM_PATH.concat(
      crypto.randomBytes(24).toString("hex")
    )
      .concat(".")
      .concat('.jpg');

    await extractFrames({
      input: tempFile,
      output: tempFrame,
      offsets: [1],
      ffmpegPath: process.env.FFMPEG_PATH,
    });

    // const dimensions = await imageSize(tempFrame);
    return await processThumbnnail(tempFrame, params, key);
    // resolve({ ...dimensions, web: smallThumbnail });
  } catch (err) {
    console.error("ERROR", err);
    return { err: 3, msg: "Issue processing video" };
  }
};
// RESEARCH: DOWNLOAD ONLY FIRST FEW FRAMES
const temporaryStore = async (url, extension) => {
  return new Promise(async (resolve, reject) => {
    try {
      const fileName = process.env.FILESYSTEM_PATH.concat(
        crypto.randomBytes(24).toString("hex")
      )
        .concat(".")
        .concat(extension);

      const readStream = await getS3Stream(process.env.VIDEOS_BUCKET, url)

      const tempFile = fs.createWriteStream(fileName);
      readStream.pipe(tempFile);
      readStream.on("end", function () {
        resolve(fileName);
      });
    } catch (err) {
      console.error("ERROR", err);
      reject({ err: 3, msg: "Issue storing temp file" });
    }
  });
};

const processThumbnnail = async (path, params, key) => {
  try {
    const readStream = fs.createReadStream(path);
    const resizeStream = stream2SharpImage(params);
    const { writeStream, success } = putS3Stream(process.env.IMAGES_BUCKET, key);

    // trigger stream
    readStream.pipe(resizeStream).pipe(writeStream);

    // wait for the stream
    await success;
    await fsPromise.unlink(path);
    // 301 redirect to new image
    return {
      statusCode: 301,
      headers: {
          location: process.env.CDN_URL + "/" + key,
      },
      body: "",
    };

  } catch (err) {
    console.log("ERROR", err);
    return { err: 3, msg: "Issue processing image" };
  }
};

const processS3Image = async (imageUrl, params, key, extension) => {
  try {
    const readStream = getS3Stream(process.env.IMAGES_BUCKET, imageUrl);
    let resizeStream = null;
    if (extension === 'gif') {
      resizeStream = stream2SharpGif(params);
    } else {
      resizeStream = stream2SharpImage(params);
    }
    const { writeStream, success } = putS3Stream(process.env.IMAGES_BUCKET, key);

    // trigger stream
    readStream.pipe(resizeStream).pipe(writeStream);

    // wait for the stream
    await success;

    // 301 redirect to new image
    return {
        statusCode: 301,
        headers: {
            location: process.env.CDN_URL + "/" + key,
        },
        body: "",
    };
  } catch (err) {
    console.log(err);
      return {
          statusCode: 500,
          body: err.message,
      };
  }

}

const getS3Stream = (bucket, key) => {
    return s3
        .getObject({
            Bucket: bucket,
            Key: key,
        })
        .createReadStream();
};

const putS3Stream = (bucket, key) => {
    const pass = new stream.PassThrough();
    return {
        writeStream: pass,
        success: s3
            .upload({
                Body: pass,
                Bucket: bucket,
                Key: key,
                ContentType: mime.getType(key),
                ACL: "public-read",
            })
            .promise(),
    };
};

const stream2SharpImage = (params) => {
    return sharp().resize(
        Object.assign(params, {
            withoutEnlargement: true,
        })
    );
};

const stream2SharpGif = (params) => {
  return sharp({ animated: true }).resize(
      Object.assign(params, {
          withoutEnlargement: true,
      })
  ).gif();
};
