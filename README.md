# Common Ground

Prey flock, hunters hunt, and the ground remembers where they went.

![Teaser](teaser/common-ground-teaser.gif)

**Live:** [https://peterhci.com/3dboids](https://peterhci.com/3dboids)

Two populations of little blob creatures live on an island in an open sea. The island is a different shape in every world, and its fractal-noise hills slowly reshape themselves as the blobs run over it. Nothing is scripted: every creature only reacts to what's right around it. As they move they dig and pile dirt, graze the grass down and leave scent, and those changes feed back into how everyone else moves. Over generations their genes drift. Depending on the random island that is generated, all the hunters or prey can die out.

You can orbit around the island, follow a single creature, and reach in with your mouse (or your hand, on a webcam) to pick creatures up and throw them.

Webcam hand interaction is powered by mediapipe.

## Controls

| Input | Does |
| --- | --- |
| drag a creature | pick it up; let go while moving to throw it |
| drag / right-drag / scroll | orbit / pan / zoom the camera |
| `g` | follow a hunter, then a prey, then back to the free camera |
| `o` | slowly orbit the board |
| `0` | reset the view |
| ✋ Hands / `h` | webcam hand tracking: pinch thumb and index finger to pick up, open to drop |
| `1` / `2` | drop 12 new prey / a new hunter where the cursor points (fresh genes) |
| `space` | pause |
| `f` | speed 1× → 2× → 4× → 8× |
| `c` | color by family line / speed gene / eyesight gene |
| `t` | show or hide scent |
| `r` | new world |
| `i` | hide the panel |
| `?` | rules |
| `v` | record 12 seconds of video |


## References

- The Book of Shaders, [ch. 13 Fractal Brownian Motion](https://thebookofshaders.com/13/) (terrain, domain warping)
- The Nature of Code, [Example 5.11 Flocking](https://natureofcode.com/autonomous-agents/#example-511-flocking) and [Example 9.5 An Evolving Ecosystem](https://natureofcode.com/genetic-algorithms/#example-95-an-evolving-ecosystem)
- Craig Reynolds, *Flocks, Herds, and Schools* (1987)
- Dirk Helbing et al., *Modelling the evolution of human trail systems* (Nature, 1997), for the idea that paths attract walkers
- Look inspired by [Primer](https://www.youtube.com/@PrimerBlobs)'s blob simulations
- Hand interaction inspired by Kern Kelley's [v6 Puppet](https://openprocessing.org/sketch/2982807)
