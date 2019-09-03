QT.multimedia_private.VERSION = 5.12.0
QT.multimedia_private.name = QtMultimedia
QT.multimedia_private.module =
QT.multimedia_private.libs = $$QT_MODULE_LIB_BASE
QT.multimedia_private.includes = $$QT_MODULE_INCLUDE_BASE/QtMultimedia/5.12.0 $$QT_MODULE_INCLUDE_BASE/QtMultimedia/5.12.0/QtMultimedia
QT.multimedia_private.frameworks =
QT.multimedia_private.depends = core_private gui_private multimedia
QT.multimedia_private.uses = pulseaudio
QT.multimedia_private.module_config = v2 internal_module
QT.multimedia_private.enabled_features = alsa linux_v4l pulseaudio
QT.multimedia_private.disabled_features = directshow directshow-player evr gpu_vivante gstreamer gstreamer_0_10 gstreamer_1_0 gstreamer_app gstreamer_encodingprofiles gstreamer_photography openal resourcepolicy wasapi wmf wmf-player wmsdk wshellitem
QMAKE_LIBS_ALSA = -lasound
QMAKE_LIBS_PULSEAUDIO = -lpulse-mainloop-glib -lpulse -lglib-2.0
QMAKE_DEFINES_PULSEAUDIO = _REENTRANT
QMAKE_INCDIR_PULSEAUDIO = /usr/include/glib-2.0 /usr/lib/x86_64-linux-gnu/glib-2.0/include