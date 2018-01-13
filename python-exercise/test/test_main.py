import unittest
import io
import contextlib
from unittest.mock import patch

from tmc import points

from tmc.utils import load, get_stdout
main = load('src.main', 'main')

def func():
    pass

@points('5.4')
class MainTest(unittest.TestCase):
    def test_00_fit(self):
        self.longMessage = False
        with patch('numpy.random.normal', side_effect=[1.2]) as prompt:
            with patch('matplotlib.pyplot.show', new_callable=func()) as prompt:
                main()
        printed = get_stdout()
        self.assertEqual(printed,'[ 1.          1.00475248]', msg="Tarkista sovitusfunktiosi")

    def test_01_makes_fit(self):
        self.longMessage = False
        import matplotlib
        with patch('matplotlib.pyplot.show', new_callable=func()) as prompt:
            main()
        printed = get_stdout()
        if not printed:
            self.fail('Tulosta sovitetun funktion parametrit')
