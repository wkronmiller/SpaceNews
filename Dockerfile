FROM node:8.1.2

ENV workdir /opt/app

RUN mkdir -p $workdir
WORKDIR $workdir

RUN npm install -g yarn

COPY .babelrc $workdir
COPY package.json $workdir
COPY yarn.lock $workdir
RUN cd $workdir && yarn

COPY src $workdir/src
COPY config.js $workdir

RUN mkdir -p lib && yarn compile

# NOTE: elasticsearch is buggy on compiled code
CMD ["yarn", "start"]
