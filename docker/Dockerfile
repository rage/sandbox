FROM debian:stretch

RUN apt-get update && \
    apt-get install -y makedev locales build-essential g++ nano procps xvfb iproute net-tools iputils-ping curl wget rsync libxrender-dev libxtst-dev check pkg-config valgrind libxslt-dev libxml2-dev libreadline-dev curl git-core zlib1g zlib1g-dev libssl-dev libyaml-dev libsqlite3-dev sqlite3 libxml2-dev libxslt-dev autoconf libc6-dev libgdbm-dev ncurses-dev automake libtool bison subversion libffi-dev openssl libxrender-dev libxtst-dev xmlstarlet python3.4 python2.7 python-pip python3-pip python-virtualenv openjdk-8-jdk openjfx maven python3-numpy python3-scipy python3-matplotlib python3-sklearn python3-tk moreutils libcurl4-openssl-dev libfreetype6 libfreetype6-dev libgl1-mesa-dev libfontconfig1-dev libx11-dev libx11-dev libxext-dev libxfixes-dev libxi-dev libxrender-dev libxcb1-dev libx11-xcb-dev libxcb-glx0-dev &&  \
    apt-key adv --keyserver keys.gnupg.net --recv-key 'E19F5F87128899B192B1A2C2AD5F960A256A04AF' && \
    echo "deb https://cran.r-project.org/bin/linux/debian stretch-cran35/ >> /etc/apt/sources.list" && \
    apt-get update && \
    apt-get install -y r-base r-base-dev r-recommended && \
    useradd --create-home user && \
    rm -rf /var/lib/apt/lists/*

COPY  ./Qt5.11 /opt/Qt5.11

ENV PATH="/opt/Qt5.11/bin:${PATH}"

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
RUN Rscript -e 'install.packages(c("devtools","testthat", "httr", "curl"),repos="http://cran.us.r-project.org")' && Rscript -e 'devtools::install_github("RTMC/tmc-r-tester/tmcRtestrunner")'
ENV M2_HOME="/usr/share/maven"

RUN pip3 install spacy

USER user
