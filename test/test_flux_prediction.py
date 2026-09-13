import math
import unittest

import torch

from backend.modules.k_prediction import PredictionFlux


class PredictionFluxTests(unittest.TestCase):
    def test_mu_transform_matches_exponential_time_shift(self):
        prediction = PredictionFlux(pseudo_timestep_range=4, mu=1.0)
        timesteps = torch.arange(1, 5, dtype=torch.float32) / 4
        expected = math.exp(1.0) / (math.exp(1.0) + (1 / timesteps - 1))

        torch.testing.assert_close(prediction.sigmas, expected)


if __name__ == "__main__":
    unittest.main()
