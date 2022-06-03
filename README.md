## How to run the code:
* npm install
* npm run start
* open localhost:3000

## What to expect
This project aims to replicate the popular game Minecraft! In our version
of the game, we predominantly support creative mode, with some aspects of
survival mode supported as well. We also add shadows and lights.

Once you go to http://localhost:3000 , you can click on the screen and the
program will grab your pointer. You're then able to move your mouse to look around.
There are instructions available on the screen.

## Creative Mode:
Fly around the world! In this mode, the player can fly around the world,
place blocks, and move through blocks. Jumping is not available.

## Survival Mode:
Walk around the world! In this mode, the player can walk around the world,
place blocks, and collide with blocks. Jumping is available, and the player
is in space, so jumping allows the player to move quite far.

Controls:
* Movement:
    * WASD for basic movements
    * F to toggle fast mode
    * Left Shift to go down (only works in creative mode)
    * Space to go up (fly up in creative, jump in survival)
* World Interaction:
    * Left Click to break blocks
    * Right Click to place blocks (select blocks with numbers 1-5)
    * M to toggle modes
* Note: All controls should be on screen while playing
    * Can click on the instruction dropdown to hide
