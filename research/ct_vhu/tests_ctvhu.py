"""最小の回帰テスト：python tests_ctvhu.py"""
import os
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ct_vhu import features as F  # noqa: E402
from ct_vhu import io as IO  # noqa: E402
from ct_vhu import pipeline as P  # noqa: E402

SP = (1.0, 0.72, 0.72)


def test_small_sphere_is_single_voxel():
    assert F.sphere_footprint(0.5, SP).sum() == 1
    assert F.sphere_footprint(1.0, SP).sum() == 7  # 面内4近傍＋上下（1.0 mm）


def test_original_not_overwritten():
    with tempfile.TemporaryDirectory() as d:
        v = IO.Volume(np.zeros((4, 5, 6), np.float32), SP)
        p = IO.save_volume(v.data, v, os.path.join(d, "ct.nrrd"))
        v2 = IO.load_volume(p)
        assert v2.data.shape == (4, 5, 6)
        try:
            IO.save_volume(v2.data, v2, p)
        except ValueError:
            pass
        else:
            raise AssertionError("元データへの上書きが拒否されない")


def test_isolated_spike_removed_and_plate_kept():
    hu = np.full((20, 40, 40), 0.0, np.float32)
    hu[:, 10:13, 5:35] = 1500.0      # 板状の骨（連続）
    hu[10, 30, 20] = 1800.0          # 単一ボクセルの高HU
    f = P.multiscale_field(hu, SP, presence="adaptive")
    assert f[10, 30, 20] < 0
    assert (f[5:15, 11, 10:30] >= 0).mean() > 0.95


def test_lps_index_roundtrip():
    v = IO.Volume(np.zeros((3, 3, 3), np.float32), SP, origin=(10.0, 20.0, 30.0))
    p = v.index_to_lps([[1, 2, 3]])[0]
    assert np.allclose(p, [10 + 3 * 0.72, 20 + 2 * 0.72, 30 + 1.0])


if __name__ == "__main__":
    for k, fn in list(globals().items()):
        if k.startswith("test_"):
            fn()
            print("ok", k)
