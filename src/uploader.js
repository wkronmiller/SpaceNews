import AWS from 'aws-sdk';
import {bucketName, bucketKey} from '../config';

class Uploader {
  configure(config) { throw 'Not implemented'; }
  upload(jsonBody) { throw 'Not implemented'; }
}

export class AWSUploader {
  constructor() {
    this._s3 = new AWS.S3();
  }
  configure({bucket: Bucket, key: Key}) {
    Bucket = Bucket || bucketName;
    Key = Key || bucketKey;
    this._uploadParams = {
      Bucket,
      Key,
      ContentType: 'application/json',
    }
  }
  upload(body) {
    const uploadParams = {
      Body: body
    };
    Object.assign(uploadParams, this._uploadParams);
    return new Promise((resolve) => this._s3.putObject(uploadParams, (err, data) => {
      if(err) { throw err; }
      return resolve(data);
    })).then(res => ({body, res}));
  }
}
