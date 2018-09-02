FROM debian:stretch

RUN apt-get update && \
    apt-get install -y makedev locales build-essential g++ nano procps xvfb iproute net-tools iputils-ping curl wget rsync libxrender-dev libxtst-dev check pkg-config valgrind libxslt-dev libxml2-dev libreadline-dev curl git-core zlib1g zlib1g-dev libssl-dev libyaml-dev libsqlite3-dev sqlite3 libxml2-dev libxslt-dev autoconf libc6-dev libgdbm-dev ncurses-dev automake libtool bison subversion libffi-dev openssl libxrender-dev libxtst-dev xmlstarlet python3.4 python2.7 python-pip python-virtualenv openjdk-8-jdk openjfx maven python3-numpy python3-scipy python3-matplotlib python3-tk moreutils libcurl4-openssl-dev libfreetype6 libfreetype6-dev libgl1-mesa-dev libfontconfig1-dev libx11-dev libx11-dev libxext-dev libxfixes-dev libxi-dev libxrender-dev libxcb1-dev libx11-xcb-dev libxcb-glx0-dev &&  \
    useradd --create-home user && \
    rm -rf /var/lib/apt/lists/*

COPY  Qt5.11 /opt/Qt5.11

ENV PATH="/opt/Qt5.11/bin:${PATH}"

WORKDIR /app
RUN chown user /app
USER user
