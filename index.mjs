// import dotenv from "dotenv";
// dotenv.config();

import fs from "fs";
import got from "got";
import axios from "axios";
import crypto from "crypto";
import request from "request";
import { promisify } from "util";
import { S3, PutObjectCommand } from "@aws-sdk/client-s3";

// PROCESSING TOOLS
import { fileTypeFromStream } from "file-type";
import { Duplex } from "stream";
import Jimp from "jimp";
import gifResize from "@gumlet/gif-resize";
import extractFrames from "ffmpeg-extract-frames";
import imagemin from "imagemin";
import imageminWebp from "imagemin-webp";
import imageminGif2webp from "imagemin-gif2webp";
import imageSizer from "image-size";
const fsPromise = fs.promises;
const imageSize = promisify(imageSizer);

import mongoose from "mongoose";
const { model, Schema } = mongoose;

const NFTSchema = new Schema({
  _id: String,
  tokenAddress: { type: String, required: true },
  tokenId: { type: String, required: true },
  tokenURI: String,
  json: String,
  originalAsset: String,
  originalAudio: String,
  originalAnimation: String,
  originalContentType: String,
  creatorAddress: String,
  creatorTitle: String,
  creatorDescription: String,
  creatorTags: [String],
  ownerAddress: String,
  ownerTitle: String,
  ownerDescription: String,
  ownerTags: [String],
  externalUrl: String,
  width: Number,
  height: Number,
  asset: String,
  mimeType: String,
  contentType: String,
  ext: String,
  duration: Number,
  webWidth: Number,
  webHeight: Number,
  webAsset: String,
  webMimeType: String,
  webContentType: String,
  webExt: String,
  audioAsset: String,
  audioMimeType: String,
  audioExt: String,
});

const NFT = model("NFT", NFTSchema);

const FFMPEG_PATH = process.env.FFMPEG_PATH;
const FILESYSTEM_PATH = process.env.FILESYSTEM_PATH;

const MAX_GRID_WIDTH = 600;

const s3Client = new S3({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_KEY,
    secretAccessKey: process.env.S3_SECRET,
  },
});

mongoose.connect(process.env.MONGO_DRIVER, {
  useUnifiedTopology: true,
  useNewUrlParser: true,
});

const handleError = (err) => {
  console.log("ERROR CODE: ", err.err);
  console.log("ERROR MSG: ", err.msg);
};

const ProtocolParser = (url) => {
  if (url.slice(0, 7) === "ipfs://") {
    return `https://alchemy.mypinata.cloud/ipfs/${url.substring(
      7,
      url.length
    )}`;
  } else if (url.slice(0, 5) === "ar://") {
    return `https://arweave.net/${url.substring(5, url.length)}`;
  } else return url;
};

const fileType = async (url) => {
  return new Promise((resolve, reject) => {
    request(url, { method: "HEAD" }, async (err, res) => {
      if (err) reject({ err: 0, msg: "Error with file type request" });
      else {
        try {
          let detectedType = res.headers["content-type"];
          if (detectedType) {
            if (detectedType === "application/octet-stream") {
              const stream = got.stream(url);
              const mime = await fileTypeFromStream(stream);
              resolve({
                ...mime,
                contentType:
                  mime && mime.toString().split("/")[0].toLowerCase(),
              });
            } else {
              detectedType = detectedType.toLowerCase().replace("jpeg", "jpg");
              resolve({
                mime: detectedType,
                contentType: detectedType.split("/")[0].toLowerCase(),
                ext: detectedType.split("/")[1],
              });
            }
          } else reject({ err: 1, msg: "No content type specified" });
        } catch {
          reject({ err: 2, msg: "Issue getting file type" });
        }
      }
    });
  });
};

const temporaryStore = async (url, mimeType) => {
  return new Promise(async (resolve, reject) => {
    try {
      const fileName = FILESYSTEM_PATH.concat(
        crypto.randomBytes(24).toString("hex")
      )
        .concat(".")
        .concat(mimeType.ext);

      const response = await axios({
        method: "GET",
        url: url,
        responseType: "stream",
      });

      const tempFile = fs.createWriteStream(fileName);
      response.data.pipe(tempFile);
      response.data.on("end", function () {
        resolve(fileName);
      });
    } catch (err) {
      console.error("ERROR", err);
      reject({ err: 3, msg: "Issue storing temp file" });
    }
  });
};

const processGif = async (path, dim) => {
  return new Promise(async (resolve, reject) => {
    try {
      const dimensions = {
        width: MAX_GRID_WIDTH,
        height: (dim.height * MAX_GRID_WIDTH) / dim.width,
      };

      const tempFile = FILESYSTEM_PATH.concat(
        crypto.randomBytes(24).toString("hex")
      ).concat(".gif");
      const write = fs.createWriteStream(tempFile);

      const buf = fs.readFileSync(path);
      await gifResize({
        width: dimensions.width,
        height: dimensions.height,
      })(buf)
        .then(async (data) => {
          const stream = new Duplex();
          stream.push(data);
          stream.push(null);
          stream.pipe(write);

          stream.once("end", async () => {
            const res = await imagemin([tempFile], {
              destination: "temp",
              plugins: [
                imageminGif2webp({
                  quality: 20,
                  mixed: true,
                  lossy: true,
                  method: 0,
                  minimize: true,
                  multiThreading: true,
                }),
              ],
            });

            resolve({
              ...dimensions,
              path: res[0].destinationPath,
              mimeType: {
                mime: "image/webp",
                contentType: "image",
                ext: "webp",
              },
            });
          });
        })
        .catch(() => {
          reject({ err: 3, msg: "Issue reading gif" });
        });
    } catch {
      reject({ err: 3, msg: "Issue processing gif" });
    }
  });
};

const processWebp = async (path, dim) => {
  return new Promise(async (resolve, reject) => {
    try {
      const dimensions = {
        width: MAX_GRID_WIDTH,
        height: (dim.height * MAX_GRID_WIDTH) / dim.width,
      };
      const res = await imagemin([path], {
        destination: "temp",
        plugins: [
          imageminWebp({
            resize: dimensions,
            quality: 50,
          }),
        ],
      });

      resolve({
        ...dimensions,
        path: res[0].destinationPath,
        mimeType: {
          mime: "image/webp",
          contentType: "image",
          ext: "webp",
        },
      });
    } catch {
      reject({ err: 3, msg: "Issue processing webp" });
    }
  });
};

const processImage = async (path, ext) => {
  return new Promise(async (resolve, reject) => {
    try {
      const tempFile = FILESYSTEM_PATH.concat(
        crypto.randomBytes(24).toString("hex")
      )
        .concat(".")
        .concat(ext);

      await Jimp.read(path)
        .then(async (image) => {
          await image.resize(MAX_GRID_WIDTH, Jimp.AUTO).writeAsync(tempFile);
        })
        .catch(() => {
          reject({ err: 4, msg: "Issue reading temp image" });
        });

      imageSize(tempFile).then(async (dimensions) => {
        resolve({
          ...dimensions,
          path: tempFile,
          mimeType: {
            mime: `image/${ext.toLowerCase()}`,
            contentType: "image",
            ext: ext.toLowerCase(),
          },
        });
      });
    } catch {
      reject({ err: 3, msg: "Issue processing image" });
    }
  });
};

const processVideo = async (path) => {
  return new Promise(async (resolve, reject) => {
    try {
      const ext = "jpg";
      const tempFrame = FILESYSTEM_PATH.concat(
        crypto.randomBytes(24).toString("hex")
      )
        .concat(".")
        .concat(ext);

      await extractFrames({
        input: path,
        output: tempFrame,
        offsets: [1],
        ffmpegPath: FFMPEG_PATH,
      });

      const dimensions = await imageSize(tempFrame);
      const smallThumbnail = await processImage(tempFrame, ext);
      await fsPromise.unlink(tempFrame);
      resolve({ ...dimensions, web: smallThumbnail });
    } catch (err) {
      console.error("ERROR", err);
      reject({ err: 3, msg: "Issue processing video" });
    }
  });
};

const webOptimizer = async (url, event) => {
  return new Promise(async (resolve, reject) => {
    let tempFile;
    try {
      let mimeType = await fileType(url).catch((err) => handleError(err));

      let result;
      if (mimeType) {
        tempFile = await temporaryStore(url, mimeType);

        const fileStream = fs.readFileSync(tempFile);
        const uploadParams = {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: `${process.env.S3_RAW_ASSET_FOLDER}/${event.id}.${mimeType.ext}`,
          Body: fileStream,
          ACL: "public-read",
        };

        await s3Client.send(new PutObjectCommand(uploadParams));

        if (mimeType.contentType === "video") {
          const res = await processVideo(tempFile).catch((err) =>
            handleError(err)
          );
          result = res;
        } else if (mimeType.ext === "gif") {
          const dimensions = await imageSize(tempFile);
          const web = await processGif(tempFile, dimensions).catch((err) =>
            handleError(err)
          );
          result = { ...dimensions, web };
        } else if (mimeType.contentType === "image") {
          let web;
          const dimensions = await imageSize(tempFile);
          if (mimeType.ext === "webp") {
            web = await processWebp(tempFile, dimensions).catch((err) =>
              handleError(err)
            );
          } else {
            web = await processImage(tempFile, mimeType.ext).catch((err) =>
              handleError(err)
            );
          }
          result = { ...dimensions, web };
        }

        console.log(
          `========== PROCESSED ${mimeType.ext.toUpperCase()} ==========`
        );
      }

      resolve({ ...result, path: tempFile, mimeType });
    } catch (err) {
      console.log("ERROR", err);
      reject({ err: 5, msg: "Issue processing file" });
    }
  }).catch((err) => handleError(err));
};

const audioOptimizer = async (url, event) => {
  return new Promise(async (resolve, reject) => {
    let tempFile;
    try {
      let mimeType = await fileType(url).catch((err) => handleError(err));

      if (mimeType && mimeType.contentType === "audio") {
        tempFile = await temporaryStore(url, mimeType);

        const fileStream = fs.readFileSync(tempFile);
        const uploadParams = {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: `${process.env.S3_AUDIO_ASSET_FOLDER}/${event.id}.${mimeType.ext}`,
          Body: fileStream,
          ACL: "public-read",
        };

        await s3Client.send(new PutObjectCommand(uploadParams));

        console.log(
          `========== PROCESSED ${mimeType.ext.toUpperCase()} ==========`
        );
      }

      resolve({ path: tempFile, mimeType });
    } catch (err) {
      console.log("ERROR", err);
      reject({ err: 5, msg: "Issue processing file" });
    }
  }).catch((err) => handleError(err));
};

export const handler = async function (event, context, callback) {
  try {
    const nft = await NFT.findById(event.id).exec();
    console.log("PROCESSING: ", event.id);
    if (nft && nft.originalAsset) {
      const result = await webOptimizer(
        ProtocolParser(nft.originalAsset),
        event
      );

      let audio;
      if (nft.originalAudio) {
        audio = await audioOptimizer(ProtocolParser(nft.originalAudio), event);
      }

      console.log(result);
      if (audio) console.log(audio);
      if (result) {
        if (result.web && result.web.path) {
          const fileStream = fs.readFileSync(result.web.path);
          const uploadParams = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: `${process.env.S3_WEB_ASSET_FOLDER}/${event.id}.${result.web.mimeType.ext}`,
            Body: fileStream,
            ACL: "public-read",
          };

          await s3Client.send(new PutObjectCommand(uploadParams));
          await fsPromise.unlink(result.web.path);
        }

        if (result.width) nft.width = result.width;
        if (result.height) nft.height = result.height;
        if (result.duration) nft.duration = result.duration;
        if (result.mimeType) {
          if (result.path) {
            await fsPromise.unlink(result.path);
            nft.asset = `${process.env.S3_RAW_ASSET_FOLDER}/${event.id}.${result.mimeType.ext}`;
          }
          if (result.mimeType.mime) nft.mimeType = result.mimeType.mime;
          if (result.mimeType.contentType)
            nft.contentType = result.mimeType.contentType;
          if (result.mimeType.ext) nft.ext = result.mimeType.ext;
        }
        if (result.web) {
          if (result.web.width) nft.webWidth = result.web.width;
          if (result.web.height) nft.webHeight = result.web.height;
          if (result.web.mimeType) {
            if (result.web.path)
              nft.webAsset = `${process.env.S3_WEB_ASSET_FOLDER}/${event.id}.${result.web.mimeType.ext}`;
            if (result.web.mimeType.mime)
              nft.webMimeType = result.web.mimeType.mime;
            if (result.web.mimeType.contentType)
              nft.webContentType = result.web.mimeType.contentType;
            if (result.web.mimeType.ext) nft.webExt = result.web.mimeType.ext;
          }
        }
        if (audio) {
          if (audio.path) {
            await fsPromise.unlink(audio.path);
            nft.audioAsset = `${process.env.S3_AUDIO_ASSET_FOLDER}/${event.id}.${result.mimeType.ext}`;
          }
          if (audio.mimeType) {
            if (audio.mimeType.mime) nft.audioMimeType = audio.mimeType.mime;
            if (audio.mimeType.ext) nft.audioExt = audio.mimeType.ext;
          }
        }

        await nft.save();

        context.callbackWaitsForEmptyEventLoop = false;
        return callback(null, {
          statusCode: 200,
          body: "Success",
        });
      }
    }
  } catch (err) {
    console.log("Error", err);
    return callback(null, {
      statusCode: 500,
      body: err,
    });
  }
};
