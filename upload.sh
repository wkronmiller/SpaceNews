#!/bin/bash
TARGET_FILE="./output.json"
TARGET_BUCKET="flash-briefs"
DEST_FILE="space-news.json"

aws s3api put-object --bucket $TARGET_BUCKET --content-type "application/json" \
  --body $TARGET_FILE --key $DEST_FILE
