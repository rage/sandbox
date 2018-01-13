import numpy as np
import matplotlib.pyplot as plt
from scipy.optimize import leastsq
##########################################################
def residuals(param, xdata, ydata):
    return ydata - (param[0]*np.sin(xdata) + param[1]*np.cos(xdata))

###########TEE MYÖS RESIDUALS FUNKTIO#####################
def main():
###########################################################
    #Generate random data
    xdata = np.linspace(0,2*np.pi,100)
    y_noise = 0.2 * np.random.normal(size=xdata.size)
    ydata = np.sin(xdata) + np.cos(xdata) + y_noise

    x0 = np.array([0,0])
    tu = leastsq(residuals, x0, args=(xdata, ydata))
    print(tu[0])

###########################################################
######### TEE TEHTÄVÄ TÄMÄN ALAPUOLELLE ###################

# ===========================================================
#Kirjoita ratkaisusi tämän viivan yläpuolelle

if __name__ == "__main__":
    main()
