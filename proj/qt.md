# PointCloud process software

![image-20250824181502604](src/image-20250824181502604.png)

## basic dependencies needed
1.qt5(just the pure library rather than the whole package)
```asm
sudo apt install build-essential
sudo apt install cmake qt5-default qtcreator
```
2.opencv-dev
```asm
sudo apt-get install libopencv-dev
```
3.pcl lib
```asm
sudo apt install libpcl-dev
```
## possible problems
while compiling this project on other pc,some head files of pcl might
not be found due to the 'find' function in cmake , so you'd better update the cmakelist.txt as 
follows so that the related files are included:
```asm
include_directories( "/usr/include/pcl-1.9/" )
include_directories( "/usr/include/eigen3/" )
```

## use of datavisualization(support 3d surface)
1.compile the datavisualiztion module
download this source from "https://download.qt.io/archive/qt/5.9/5.9.5/submodules/"
```asm
qmake CONFIG+="debug_and_release build_all"
make
make install
```
2.update your cmakelists.txt

**pay attention to the capitalization!! the cmake have strong limitation**
```asm
set(QT_VERSION 5)
set(REQUIRED_LIBS Core Widgets DataVisualization)
set(REQUIRED_LIBS_QUALIFIED Qt5::Core Qt5::Widgets  Qt5::DataVisualization)
```
