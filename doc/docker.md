# Docker guide

## Dockerhub

https://hub.docker.com/repository/docker/boi12321/porn-vault

## Build image

You can build a docker image yourself with the `Dockerfile`s in the `docker` folder. To do this, you must "clone" this git repository or download a zip from Github. Then you can follow one of the steps below.
If you want to build using an already built image, the parameters described should still be valid.

> **WARNING**: the docker context (i.e. where you are running the command from) has to be the root of the repository. You just need to specify the path to the appropriate Dockerfile.

## Images

There are two `Dockerfile`s in the `docker` folder that allow you to either build an image from Debian or Alpine.

## docker create

```
docker create \
  --name=porn-vault \
  -p 3000:3000 \
  -v /etc/localtime:/etc/localtime:ro \
  -v /path/to/library_parent_dir:/config \
  -v /path/to/config.json:/config.json \
  -v /path/to/first/videos:/videos_1 \
  -v /path/to/more/videos:/videos_2 \
  -v /path/to/first/images:/images_1 \
  -v /path/to/more/images:/images_2 \
  --restart unless-stopped \
  -f docker/Dockerfile.debian
  .
```

Then start the container `docker start porn-vault`.

If you want to create a container using an image from Docker Hub, replace the path (the last line) with the docker image name from the registry.  
Example:

```
docker create \
  <params> \
  dummy_username/porn-vault:latest
```

## docker-compose

```
version: "3"
services:
  porn-vault:
    build:
      context: .
      dockerfile: ./docker/Dockerfile.debian
    container_name: porn-vault
    volumes:
      - "/etc/localtime:/etc/localtime:ro"
      - "/path/to/library_parent_dir:/config"
      - "/path/to/config.json:/config.json"
      - "/path/to/first/videos:/videos_1"
      - "/path/to/more/videos:/videos_2"
      - "/path/to/first/images:/images_1"
      - "/path/to/more/images:/images_2"
    ports:
      - "3000:3000"
    restart: unless-stopped
```

If you want to create using an image from Docker Hub, replace the whole `build` (and it's sub config) with `image: <image_name>` using the image name from the registry.  
Example:

```
version: "3"
services:
  porn-vault:
    image: dummy_username/porn-vault:latest
```

## Docker parameters

The container requires some parameters for the app to run correctly. These parameters are separated by a colon and indicate `<external>:<internal>` respectively. For example, `-p 8080:3000` would expose port `3000` from inside the container to be accessible from the host's IP on port `8080` outside the container.

|               Parameter                | Function                                                                                                                                                                                                          |
| :------------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|               `-p 3000`                | The port for the porn-vault webinterface. This must match what is in your config file.                                                                                                                            |
| `-v /config.json` OR `-v /config.yaml` | Location of the config file to read from. It must be either one of these. **IMPORTANT:** If no config is found, a default config will be written. You may then stop the container, adjust the config and restart. |
|              `-v /config`              | Directory for the `persistence.libraryPath` setting in the config file. This allows for the database to be persisted on the host. It must be exactly this name.                                                   |
|              `-v /videos`              | A directory for the `import.videos` config setting. The volume can have whatever name you want such as `/videos_from_drive_1` or `/videos_from_drive_2` _as long as you use that name in your config_.            |
|              `-v /images`              | A directory for the `import.images` config The volume can have whatever name you want such as `/images_from_drive_1` or `/images_from_drive_2` _as long as you use that name in your config_.                     |

The 'videos' and 'images' volume names do not have to be strictly named as such and are not strictly necessary. If you have a folder structure like this:

```
my-stuff/
├── images
└── videos
```

You could have a single volume such as `-v /my-stuff:/root_stuff` and then use it like this in your config file:

```json
{
  "import": {
    "videos": ["/root_stuff/videos"],
    "images": ["/root_stuff/images"]
  }
}
```

## Notes

When using Docker, the `binaries.ffmpeg` & `binaries.ffprobe` paths in the config must be valid, otherwise the program will exit. The defaults are:

```json
{
  "binaries": {
    "ffmpeg": "/usr/bin/ffmpeg",
    "ffprobe": "/usr/bin/ffprobe"
  }
}
```
