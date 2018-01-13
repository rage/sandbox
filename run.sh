#!/bin/sh
set -eu

ID=$(uuidgen)
OUTPUT_PATH="$ID"_test_ouput.txt

# docker build . -t nygrenh/sandbox-next

docker create --name "$ID" -i nygrenh/sandbox-next sh
docker cp test-exercise/. "$ID":/app
docker start -i "$ID"
docker cp "$ID":/app/test_output.txt "$OUTPUT_PATH"
python3 -m json.tool < $OUTPUT_PATH
rm "$OUTPUT_PATH"
docker rm "$ID"
