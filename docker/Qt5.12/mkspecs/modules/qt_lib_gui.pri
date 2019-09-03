QT.gui.VERSION = 5.12.0
QT.gui.name = QtGui
QT.gui.module = Qt5Gui
QT.gui.libs = $$QT_MODULE_LIB_BASE
QT.gui.includes = $$QT_MODULE_INCLUDE_BASE $$QT_MODULE_INCLUDE_BASE/QtGui
QT.gui.frameworks =
QT.gui.bins = $$QT_MODULE_BIN_BASE
QT.gui.plugin_types = platforms platforms/darwin xcbglintegrations platformthemes platforminputcontexts generic iconengines imageformats egldeviceintegrations
QT.gui.depends = core
QT.gui.uses =
QT.gui.module_config = v2
QT.gui.DEFINES = QT_GUI_LIB
QT.gui.enabled_features = accessibility action clipboard colornames cssparser cursor desktopservices imageformat_xpm draganddrop imageformatplugin highdpiscaling im image_heuristic_mask image_text imageformat_bmp imageformat_jpeg imageformat_png imageformat_ppm imageformat_xbm movie pdf picture sessionmanager shortcut standarditemmodel systemtrayicon tabletevent texthtmlparser textodfwriter validator whatsthis wheelevent
QT.gui.disabled_features = opengles2 dynamicgl angle combined-angle-lib opengl openvg opengles3 opengles31 opengles32 vulkan
QT_CONFIG += accessibility accessibility-atspi-bridge action clipboard colornames cssparser cursor desktopservices imageformat_xpm draganddrop freetype fontconfig gbm imageformatplugin harfbuzz highdpiscaling ico im image_heuristic_mask image_text imageformat_bmp imageformat_jpeg imageformat_png imageformat_ppm imageformat_xbm kms movie pdf picture sessionmanager shortcut standarditemmodel systemtrayicon tabletevent texthtmlparser textodfwriter validator whatsthis wheelevent
QT_MODULES += gui
