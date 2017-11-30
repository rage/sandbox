FROM debian:stretch

RUN apt-get update && \
    apt-get install -y makedev locales build-essential g++ nano procps xvfb iproute net-tools iputils-ping curl wget rsync libxrender-dev libxtst-dev check pkg-config valgrind libxslt-dev libxml2-dev libreadline-dev curl git-core zlib1g zlib1g-dev libssl-dev libyaml-dev libsqlite3-dev sqlite3 libxml2-dev libxslt-dev autoconf libc6-dev libgdbm-dev ncurses-dev automake libtool bison subversion libffi-dev openssl libxrender-dev libxtst-dev xmlstarlet python3.4 python2.7 python-pip python-virtualenv openjdk-8-jdk maven && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
CMD ./tmc-run
