# Minesweeper Probability Engine for Node.js

This is my implementation of Michael Gottlieb's superb algorithm for calculating the probability of a tile being a mine on an arbitratry minesweeper position.

My version uses BigInt variables (for accuracy, although it really isn't needed) and has a Binomial Coefficient cache to improved performance for very large boards.

The code for the probability engine is found in ProbabilityEngine.js, everything else is node.js comms and my test harness.

The entry point function is: calculate(message)

The input is a Javascript Object (called message below) contains the following;
```
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
Only revealed tiles need to be sent.  This excludes all flagged tiles.

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
```

Only covered tiles are returned.  This includes all flagged tiles.  A correctly flagged tile will have safety of 0 (zero).  

A successful response will have response.valid = true and no message.  An error will have valid = false and a message.

response.board is the same as message.board and can be used to pass additional information which will be bounced back.
