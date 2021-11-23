# Minesweeper Solver for Node.js
## What is it?
This is my minesweeper solver implemented as a Node.js server.

## What can it do?

- Implementation of Michael Gottlieb's superb algorithm for calculating the probability of a tile being a mine on an arbitratry minesweeper position.
- Detect dead tiles
- Detect 50/50s and pseudo-50/50s
- Use a safety and progress heuristic to pick a good guess mid game
- Use brute force during the end game to find (one of) the best series of moves to maximise the chance of winning the game

Features other than the probability engine can be turned off (either globally or by message) if not required.  Refer to class 'PeConstant' at the top off 'ProbabilityEngine.js' to see the global options available.

Also included is a test harness to perform bulk runs.

## Input and Ouput

The input is a Javascript Object (called message below) containing the following;
```
  message.options
  message.board.width
               .height
               .mines
  message.tiles[tile]
```
Tile description
```
  tile.x
      .y
      .value
```
Only revealed tiles need to be sent.  This excludes all flagged tiles. Tiles without a value property are ignored.

The response is a Javascript Object (called response below) containing the following
```
  response.valid  
          .message
          .board
          .tiles[tile]
```
Tile description
```
  tile.x
      .y
      .safety
      .dead
      .play
```

Only covered tiles are returned.  This includes all flagged tiles.  A correctly flagged tile will have safety of 0 (zero).  

If there is a 'dead' property this means that the solver has determined that the tile can only have one possible value, or be a mine.  It is never correct to guess a dead tile.

If there is a 'play' property this is the tile that the solver recommends.  The play property is set by either the tiebreak logic, the 50/50 detection logic or the brute force logic.  if none of these is used then there won't be a play property assigned.

A successful response will have response.valid = true and no message.  An error will have valid = false and a message.

response.board is the same as message.board and can be used to pass additional information which will be bounced back.

The client module 'main.js contains example code for calling the server in function 'Solve()'.

## Which modules contain the solver logic

The solver logic sits in ProbabilityEngine.js and SolverFunctions.js

## worker pool

The server 'server.js' uses 'WorkerPool' npm to move the processing off the main node.js thread.  Each worker has its own copy of the solver including the Binomial Coefficient and Prime number cache.  It would be very inefficient to build these caches for each request.  Care should be taken if you move away from this model to ensure that initialiation only occurs once per worker.

