FROM debian:jessie

RUN apt-get update && \
    apt-get install -y makedev locales build-essential g++ nano procps xvfb iproute net-tools iputils-ping curl wget rsync libxrender-dev libxtst-dev check pkg-config valgrind libxslt-dev libxml2-dev libreadline6 libreadline6-dev curl git-core zlib1g zlib1g-dev libssl-dev libyaml-dev libsqlite3-dev sqlite3 libxml2-dev libxslt-dev autoconf libc6-dev libgdbm-dev ncurses-dev automake libtool bison subversion libffi-dev openssl libxrender-dev libxtst-dev xmlstarlet python3.4 python2.7 python-pip python-virtualenv

RUN echo "deb http://ppa.launchpad.net/webupd8team/java/ubuntu xenial main" | tee /etc/apt/sources.list.d/webupd8team-java.list

RUN echo "deb-src http://ppa.launchpad.net/webupd8team/java/ubuntu xenial main" | tee -a /etc/apt/sources.list.d/webupd8team-java.list

RUN apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys EEA14886

RUN apt-get update

RUN echo debconf shared/accepted-oracle-license-v1-1 select true | \
  debconf-set-selections

RUN echo debconf shared/accepted-oracle-license-v1-1 seen true | \
  debconf-set-selections

RUN apt-get install -y oracle-java8-installer oracle-java8-set-default

RUN apt-get install -y maven

ADD test-exercise /app

WORKDIR /app
CMD ./tmc-run
