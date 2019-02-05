FROM debian:stretch

RUN apt-get update && \
    apt-get install -y makedev locales build-essential g++ nano procps xvfb iproute2 net-tools iputils-ping curl wget rsync libxrender-dev libxtst-dev check pkg-config valgrind libxslt-dev libxml2-dev libreadline-dev curl git-core zlib1g zlib1g-dev libssl-dev libyaml-dev libsqlite3-dev sqlite3 libxml2-dev libxslt-dev autoconf libc6-dev libgdbm-dev ncurses-dev automake libtool bison subversion libffi-dev openssl libxrender-dev libxtst-dev xmlstarlet python2.7 python-pip python3-pip python-virtualenv maven python3-numpy python3-scipy python3-matplotlib python3-sklearn python3-skimage python3-tk moreutils python3-pandas libcurl4-openssl-dev libfreetype6 libfreetype6-dev libgl1-mesa-dev libfontconfig1-dev libx11-dev libx11-dev libxext-dev libxfixes-dev libxi-dev libxrender-dev libxcb1-dev libx11-xcb-dev libxcb-glx0-dev software-properties-common libncurses5-dev libgdbm-dev libnss3-dev libssl-dev libreadline-dev libffi-dev zlib1g openjdk-8-jdk openjfx libcglib3-java gnupg2 libdouble-conversion1 libxcb-xkb1 libxcb-render-util0 libxcb-xinerama0 libxcb-image0 libxcb-keysyms1 libxcb-icccm4 libxkbcommon-x11-0 libxcb-xkb1 && \
    apt-key adv --keyserver keys.gnupg.net --no-tty --recv-keys 'E19F5F87128899B192B1A2C2AD5F960A256A04AF' && \
    echo "deb https://cran.r-project.org/bin/linux/debian stretch-cran35/ >> /etc/apt/sources.list" && \
    apt-get update && \
    apt-get install -y r-base r-base-dev r-recommended && \
    useradd --create-home user && \
    rm -rf /var/lib/apt/lists/*

 RUN bash -c "mkdir -p /pythonbuild && cd /pythonbuild && wget https://www.python.org/ftp/python/3.7.0/Python-3.7.0.tgz && tar -xzvf Python-3.7.0.tgz && cd Python-3.7.0/ && ./configure && make && make install"

COPY  ./Qt5.12 /opt/qt

ENV PATH="/opt/qt/bin:${PATH}"

WORKDIR /app
RUN chown user /app
USER user

COPY maven-template /app/

RUN mvn clean compile test-compile
RUN mvn -U dependency:resolve-plugins dependency:go-offline compile dependency:resolve-plugins
RUN mvn test || true
RUN mvn fi.helsinki.cs.tmc:tmc-maven-plugin:1.6:test || true

COPY maven-template-2 /app/

RUN mvn test || true
RUN mvn fi.helsinki.cs.tmc:tmc-maven-plugin:1.6:test || true

USER root
RUN Rscript -e 'install.packages(c("devtools","testthat", "httr", "curl"),repos="https://ftp.eenet.ee/pub/cran/")' && Rscript -e 'devtools::install_github("RTMC/tmc-r-tester/tmcRtestrunner")'
ENV M2_HOME="/usr/share/maven"

RUN pip3 install spacy numpy scipy matplotlib sklearn scikit-image pandas seaborn lxml matplotlib

COPY Dockerfile /Dockerfile

COPY tmc-langs.jar /tmc-langs.jar

USER user
