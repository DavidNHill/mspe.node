/**
 * This file contains the entire solver logic
 *    -  The entry point: function calculate(message)
 */

"use strict";

const workerpool = require('workerpool');

// create a worker and register public functions
workerpool.worker({
    calculate: calculate
});

/*
module.exports = {
    calculate: function (message) {
        return calculate(message);
    }
}
*/

const functions = require('./SolverFunctions');

class PeConstant {

    // Send activity messages to the console (should be false unless running tests)
    // Can be overridden to false by property 'message.options.verbose'
    static VERBOSE = true;

    // try to detect dead tiles during the probability engine processing and mark them
    // recommended setting is true, can be turned off by property 'message.options.allowDeadTileAnalysis'
    static ALLOW_DEAD_TILE_ANALYSIS = true;

    // Allow the tiebreak logic (secondary safety with progress) to be used to find a recommended tile
    //recommended setting is true, can be turned off by property 'message.options.allowTieBreak'
    static ALLOW_TIEBREAK = true;

    // Allow the 50/50 logic to be used to find a recommended tile
    //recommended setting is true, can be turned off by property 'message.options.allow5050Check'
    static ALLOW_5050_CHECK = true;

    // The maximum number of solutions when BFDA will be attempted. 
    static MAXIMUM_BFDA_SOLUTIONS = 1000;

    // The default number of solutions when BFDA will be attempted.
    // can be overriden up to the maximum by property 'message.options.bruteForceThreshold'
    static DEFAULT_BFDA_SOLUTIONS = 200;

    // Always process an isolated edge even if a safe tile is found elsewhere.  An isolated edge with a safe tile isn't considered.
    // This is the human best practice, solve small section which have a known number of mines.  Has no affect on solver effectiveness.
    static ALWAYS_DO_ISOLATED_EDGE = true;

    // check for a 50/50 and pseudo 50/50 even if a safe tile has been found
    // This is the human best practice, solve 50/50s even if there are safe tiles available.  Has no affect on solver effectiveness.
    static ALWAYS_CHECK_FOR_5050 = true;

    // used to easily get small binomial coefficients
    static SMALL_COMBINATIONS = [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1], [1, 4, 6, 4, 1], [1, 5, 10, 10, 5, 1], [1, 6, 15, 20, 15, 6, 1], [1, 7, 21, 35, 35, 21, 7, 1], [1, 8, 28, 56, 70, 56, 28, 8, 1]];

    // this is the largest binomial coefficient supported. Must be greater than width x height of the maximum sized board.
    static MAX_BINOMIAL_COEFFICIENT = 50000;

    // this is the binomial coefficients pre-calculated.  The array needed is "size * (size - 1) / 2".   A size of 500 supports 30x16 sized boards without further calculation.
    static BINOMIAL_CACHE_SIZE = 500;   

    static TIEBREAK_OFFSETS = [[2, 0], [-2, 0], [0, 2], [0, -2]];

    // How many iterations we're prepared to do to find the actual solutions (neeeded for the brute force deep analysis);
    static BRUTE_FORCE_CYCLES_THRESHOLD = 1000000;

    // How many brute force deep analysis nodes we're prepared to analyse before stopping
    static BRUTE_FORCE_ANALYSIS_MAX_NODES = 1000000;

    // Prune the game tree as we do the brute force analysis.  This should be true for performance reasons.
    static PRUNE_BF_ANALYSIS = true;

    // Only store the game tree to this depth.  Analysis goes to the end, but not stored deeper than this. Trees can take up a lot of memory and there is no reason to hold them once the branch is completed.
    static BRUTE_FORCE_ANALYSIS_TREE_DEPTH = 4;

    static INDENT = "................................................................................";

    // ways to place mines in a 2x2 box.  used by the pseudo-50/50 detection logic
    static PSEUDO_5050_PATTERNS = [
        [true, true, true, true],   // four mines
        [true, true, true, false], [true, false, true, true], [false, true, true, true], [true, true, false, true],   // 3 mines
        [true, false, true, false], [false, true, false, true], [true, true, false, false], [false, false, true, true],   // 2 mines
        [false, true, false, false], [false, false, false, true], [true, false, false, false], [false, false, true, false]  // 1 mine   
    ];

}
Object.freeze(PeConstant);  // ensure they remain constants

// interprets the data we have received
//  message.options.   (various)
//  message.board.width
//               .height
//               .mines
//  message.tiles[tile]
//
//  tile.x
//      .y
//      .value
//
// only revealed tiles need to be sent.
//
//  This will look for trivially located mines and then call the probability engine and other functions as required.
//  Confirmed mines have a safety of 0 (zero).  This allows flagged tiles to be verified as being correct.

function calculate(message) {

    const reply = {};
    const start = Date.now();

    // wrap everything in a try/catch so the caller doesn't have to take responsibility
    try {

        // look for options passed in the message
        const globalOptions = (message.options == null) ? {} : message.options;
        if (globalOptions.allowTieBreak == null) {
            globalOptions.allowTieBreak = PeConstant.ALLOW_TIEBREAK;
        } else {
            globalOptions.allowTieBreak = globalOptions.allowTieBreak && PeConstant.ALLOW_TIEBREAK;
        }
        if (globalOptions.allowDeadTileAnalysis == null) {
            globalOptions.allowDeadTileAnalysis = PeConstant.ALLOW_DEAD_TILE_ANALYSIS;
        } else {
            globalOptions.allowDeadTileAnalysis = globalOptions.allowDeadTileAnalysis && PeConstant.ALLOW_DEAD_TILE_ANALYSIS;
        }
        if (globalOptions.verbose == null) {
            globalOptions.verbose = PeConstant.VERBOSE;
        } else {
            globalOptions.verbose = globalOptions.verbose && PeConstant.VERBOSE;
        }
        if (globalOptions.allow5050Check == null) {
            globalOptions.allow5050Check = PeConstant.ALLOW_5050_CHECK;
        } else {
            globalOptions.allow5050Check = globalOptions.allow5050Check && PeConstant.ALLOW_5050_CHECK;
        }
        if (globalOptions.bruteForceThreshold == null) {
            globalOptions.bruteForceThreshold = PeConstant.DEFAULT_BFDA_SOLUTIONS;
        } else {
            globalOptions.bruteForceThreshold = Math.min(globalOptions.bruteForceThreshold, PeConstant.MAXIMUM_BFDA_SOLUTIONS);
        }
        Object.freeze(globalOptions);

        if (globalOptions.verbose) {
            console.log("Allow tiebreak: " + globalOptions.allowTieBreak);
            console.log("Allow dead tile analysis: " + globalOptions.allowDeadTileAnalysis);
            console.log("Allow 50/50 check: " + globalOptions.allow5050Check);
            console.log("BFDA threshold: " + globalOptions.bruteForceThreshold);
        }


        // get board dimensions
        const width = message.board.width;
        const height = message.board.height;
        const mines = message.board.mines;

        // Do some basic validation.  Might have to beef this up if we're not being called by a trusted source.
        if (width == null) {
            throw new Error("Property 'message.board.width' is missing");
        }
        if (height == null) {
            throw new Error("Property 'message.board.height' is missing");
        }
        if (mines == null) {
            throw new Error("Property 'message.board.mines' is missing");
        }

        console.log("Game with dimensions " + width + "x" + height + "/" + mines + " received");

        // we'll need how many mines left to find and how many tiles still covered
        let coveredCount = 0;      // this is the number of tiles off the edge and not trivially containing a mine.
        let minesToFind = mines;

        // store the tiles in an array
        const allTiles = Array(width * height);

        for (let tile of message.tiles) {
            if (tile.x >= width || tile.x < 0) {
                throw new Error("Property 'tile.x' is out of range: " + tile.x);
            }

            if (tile.y >= height || tile.y < 0) {
                throw new Error("Property 'tile.y' is out of range: " + tile.y);
            }

            // only accept tiles with values
            if (tile.value != null) {
                if (tile.value < 0 || tile.value > 8) {
                    throw new Error("Property 'tile.value' is out of range: " + tile.value);
                }
                let index = tile.x + tile.y * width;
                allTiles[index] = tile;
            }


        }

        // add any missing tiles
        for (let i = 0; i < allTiles.length; i++) {
            if (allTiles[i] == null) {
                const tile = {};
                tile.x = i % width;
                tile.y = (i - tile.x) / width;
                allTiles[i] = tile;
            }
        }

         // all the tiles which are still covered including mines, these are the ones we'll be returning
        const coveredTiles = [];

        // place to store unsatisfied uncovered tiles - i.e. things we still need to work on
        const witnesses = [];

         // identify trivially discovered mines
        for (let i = 0; i < allTiles.length; i++) {

            const tile = allTiles[i];

            // if the tile is still covered then nothing to check
            if (tile.value == null) {
                coveredTiles.push(tile);  // covered tiles including mines
                coveredCount++;
                continue;
            }

            // count the number of covered adjacent tiles
            let adjCovered = 0;
            for (let adjTile of functions.adjacentIterator(width, height, allTiles, tile)) {
                if (adjTile.value == null) {
                    adjCovered++;
                }
            }

            // if the number of mines to find is the same as the number of covered tiles left adjacent then mark them as mines
            if (allTiles[i].value == adjCovered) {

                for (let adjTile of functions.adjacentIterator(width, height, allTiles, tile)) {
                    if (adjTile.value == null) {
                        if (adjTile.value == null && adjTile.mine == null) {
                            minesToFind--;
                            coveredCount--;
                            adjTile.mine = true;
                            adjTile.safety = 0;
                        }
                    }
                }

            } else {
                witnesses.push(tile);  // if uncovered and not satisifed still work to do
            }
        }

        // get all the tiles adjacent to unsatisfied witnesses
        const work = new Set();  // use a set to deduplicate the witnessed tiles
        for (let tile of witnesses) {

            for (let adjTile of functions.adjacentIterator(width, height, allTiles, tile)) {
                if (adjTile.value == null && adjTile.mine == null) {   // not a mine and covered
                    const index = adjTile.x + adjTile.y * width;
                    work.add(index);
                }
            }

        }

        const witnessed = [];
        for (let index of work) {
            witnessed.push(allTiles[index]);
        }

        let offEdgeSafety;

        // the board details
        const board = {};
        board.width = width;
        board.height = height;
        board.mines = mines;
        board.allTiles = allTiles;

        let pe;
        let tieBreakTiles;
        // if there are no witnesses then the safety is "mines to find" / "covered tiles"  
        if (coveredCount == 0) {

            console.log("The position is completed, nothing to do");

        } else {  // use the probability engine

            // options 
            const options = {};
            options.verbose = globalOptions.verbose;
            options.deadTileAnalysis = globalOptions.allowDeadTileAnalysis;  // this will attempt to find dead tiles.  It is only correct to guess a dead tile if all the tiles are dead.
            options.apply = true;             // apply the safety values to the tiles

            // send all this information into the probability engine
            pe = new ProbabilityEngine(board, witnesses, witnessed, coveredCount, minesToFind, options);

            if (pe.validWeb) {
                pe.process();

                if (pe.finalSolutionsCount == 0) {
                    throw new Error("Position is not logically consistent");
                } else {
                    offEdgeSafety = pe.offEdgeProbability.toFixed(6);

                    // tiles without a calculated safety must be off the edge, so set to the off edge safety.  Mines were set to safety zero earlier.
                    for (let tile of coveredTiles) {
                        if (tile.safety == null) {
                            tile.safety = offEdgeSafety;
                            tile.offEdge = true;
                        }
                    }

                    // if we don't have a safe tile then look for an unavoidable 50/50
                    let foundSomething = false;

                    // if we have only 1 solution then we've solved the game and we can ignore any other analysis
                    if (pe.finalSolutionsCount == 1) {
                        foundSomething = true;
                    }

                    if ((pe.bestProbability != 1 || PeConstant.ALWAYS_CHECK_FOR_5050) && globalOptions.allow5050Check && !foundSomething) {

                        // See if there are any unavoidable 2 tile 50/50 guesses 
                        const unavoidable5050a = pe.checkForUnavoidable5050();
                        if (unavoidable5050a != null) {
                            console.log(functions.tileAsText(unavoidable5050a) + " is an unavoidable 50/50 guess.");
                            unavoidable5050a.play = true;
                            foundSomething = true;
                        }

                        // look for any 50/50 or safe guesses 
                        if (!foundSomething) {
                            const unavoidable5050b = checkForPseudo5050(globalOptions, board, minesToFind);
                            if (unavoidable5050b != null) {
                                console.log(functions.tileAsText(unavoidable5050b) + " is an unavoidable 50/50 guess, or safe.");
                                unavoidable5050b.play = true;
                                foundSomething = true;
                            }
                        }
                    }

                    let bfdaCompleted = false;
                    let bfda;

                    // if we have an isolated edge process that
                    if ((pe.bestProbability != 1 || PeConstant.ALWAYS_DO_ISOLATED_EDGE) && pe.isolatedEdgeBruteForce != null && !foundSomething) {

                        const solutionCount = pe.isolatedEdgeBruteForce.crunch();

                       console.log("Solutions found by brute force for isolated edge " + solutionCount);

                        bfda = new BruteForceAnalysis(pe.isolatedEdgeBruteForce.allSolutions, pe.isolatedEdgeBruteForce.iterator.tiles, options.verbose);  // the tiles and the solutions need to be in sync

                        bfda.process();

                        // if the brute force deep analysis completed then use the results
                        if (bfda.completed) {
                            bfdaCompleted = true;
                            foundSomething = true;
                        }

                    }


                    // see if we can do a Brute Force Deep Analysis
                    if (pe.bestProbability != 1 && pe.finalSolutionsCount < globalOptions.bruteForceThreshold && !foundSomething) {

                        pe.generateIndependentWitnesses();

                        const iterator = new WitnessWebIterator(pe, coveredTiles, -1);

                        if (iterator.cycles <= PeConstant.BRUTE_FORCE_CYCLES_THRESHOLD) {
                            const bruteForce = new Cruncher(board, iterator);

                            const solutionCount = bruteForce.crunch();

                            console.log("Solutions found by brute force " + solutionCount + " after " + iterator.getIterations() + " cycles");

                            bfda = new BruteForceAnalysis(bruteForce.allSolutions, iterator.tiles, options.verbose);  // the tiles and the solutions need to be in sync

                            bfda.process();

                            if (bfda.completed) {
                                bfdaCompleted = true;
                                foundSomething = true;
                            }

                        } else {
                            console.log("Brute Force requires too many cycles - skipping BFDA: " + iterator.cycles);
                        }
                    }

                    // if we completed the analysis mark the best option
                    if (bfdaCompleted) {
                        for (const tile of bfda.deadTiles) {
                            tile.dead = true;
                        }

                        if (!bfda.allDead) {   
                            bfda.bestTile.play = true;
                        } else {
                            bfda.allTiles[0].play = true;  // if all the tiles are dead then suggest any of the tiles
                        }
                    }

                    // Use the tie break logic
                    if (pe.bestProbability != 1 && globalOptions.allowTieBreak && !foundSomething) {
                        let includeOffEdge = false;
                        if (pe.offEdgeProbability > pe.bestOnEdgeProbability * 0.95) {
                            includeOffEdge = true;
                        }
                        tieBreakTiles = determineTieBreakTiles(globalOptions, witnesses, witnessed, board, coveredTiles, pe.bestProbability, coveredCount, includeOffEdge);
                    }

                }
            } else {
                throw new Error("Position is not logically consistent");
            }

        }

        // sort the tiles into safest first order
        coveredTiles.sort(function (a, b) { return b.safety - a.safety });

        if (tieBreakTiles != null && tieBreakTiles.length != 0) {
            if (tieBreakTiles.length == 1) {  // if only 1 tile then no need to tiebeak
                tieBreakTiles[0].tile.play = true;
            } else {
                tieBreak(globalOptions, board, pe, tieBreakTiles);
            }
        }

        // tidy up the outgoing tiles by removing unneeded properties
        for (let tile of coveredTiles) {
            if (tile.mine) {  
                delete tile.mine;
            }
            if (tile.offEdge) {
                delete tile.offEdge;
            }
        }

        // set up the reply
        reply.valid = true;
        reply.board = message.board;
        reply.tiles = coveredTiles;
 
    } catch (e) {
        console.log(e.name + ": " + e.message);
        console.log(e.stack);
        //console.trace();  // dump the trace

        // return a error response
        reply.valid = false;
        reply.message = e.name + ": " + e.message;
        reply.tiles = [];
    }

    console.log("Duration: " + (Date.now() - start) + " milliseconds");

    return reply;
}

/*
 *  Determine which tiles are to be considered in the tiebreak logic
 */
function determineTieBreakTiles(globalOptions, witnesses, witnessed, board, coveredTiles, bestProbability, coveredCount, includeOffEdge) {

    //console.log("Getting tiebreak tiles");

    const selected = [];

    // consider all tiles on the edge within 10% of the best
    const threshold = bestProbability * 0.9;
 
    let onEdgeSelected = 0;
    for (let tile of witnessed) {
        if (tile.dead == null && tile.safety > threshold) {
            const action = {};
            action.tile = tile;
            selected.push(action);
            onEdgeSelected++;
        }
    }

    if (globalOptions.verbose) {
        console.log("Selected " + onEdgeSelected + " tiles from the edge");
    }


    // should we include the off edge tiles?
    if (includeOffEdge) {

        let offEdgeSelected = 0;

        // if there are only a small number of tiles off the edge then consider them all
        if (coveredCount - witnessed.length < 20) {
            for (let tile of coveredTiles) {
                // if the tile isn't on the edge
                if (tile.offEdge) {
                    const action = {};
                    action.tile = tile;
                    selected.push(action);

                    offEdgeSelected++;
                }
            }

        } else {  // otherwise prioritise those most promising

            const accepted = new Set();  // use a map to deduplicate the selected off edge tiles
            const offsets = PeConstant.TIEBREAK_OFFSETS;

            // look for tiles 2 away from witnesses
            for (let tile of witnesses) {

                for (let j = 0; j < offsets.length; j++) {

                    const x1 = tile.x + offsets[j][0];
                    const y1 = tile.y + offsets[j][1];

                    if (x1 >= 0 && x1 < board.width && y1 >= 0 && y1 < board.height) {

                        const index = x1 + y1 * board.width;
                        const workTile = board.allTiles[index];

                        // not on the edge and not already cleared
                        if (workTile.offEdge && workTile.value == null) {
                            accepted.add(workTile);
                        }
                    }
                }

            }

            for (let tile of coveredTiles) {

                // if the tile isn't alrerady being analysed and isn't on the edge
                if (tile.offEdge && !accepted.has(tile)) {

                    // count the number of covered adjacent tiles
                    let adjCovered = 0;
                    for (let adjTile of functions.adjacentIterator(board.width, board.height, board.allTiles, tile)) {
                        if (adjTile.value == null && adjTile.mine == null) {
                            adjCovered++;
                        }
                    }

                    if (adjCovered > 1 && adjCovered < 4) {
                        accepted.add(tile);
                    }

                }

            }

            // generate an array of tiles from the map
            for (let tile of accepted) {
                const action = {};
                action.tile = tile;
                selected.push(action);
                offEdgeSelected++;
            }

        }

        if (globalOptions.verbose) {
            console.log("Selected " + offEdgeSelected + " tiles from off the edge");
        }
    }

    // sort the tiles into safest first order
    selected.sort(function (a, b) { return b.tile.safety - a.tile.safety });

    return selected;

}

/*
 *    Logic to tie break against the best tiles
 */
function tieBreak(globalOptions, board, pe, tieBreakTiles) {

    const start = Date.now();

    console.log("Tiebreak using " + tieBreakTiles.length + " Tiles selected ");

    let best;
    for (let tile of tieBreakTiles) {
        secondarySafetyAnalysis(globalOptions, pe, board, tile, best) // updates variables in the Action class

        if (best == null || best.weight < tile.weight) {
            best = tile;
        }

    }

    tieBreakTiles.sort(function (a, b) {

        let c = b.weight - a.weight;
        if (c != 0) {
            return c;
        } else {
            return b.expectedClears - a.expectedClears;
        }

    });

    findAlternativeMove(tieBreakTiles);

    console.log("Solver recommends " + functions.tileAsText(tieBreakTiles[0].tile));

    tieBreakTiles[0].tile.play = true;

    //console.log("Best Guess analysis took " + (Date.now() - start) + " milliseconds to complete");

}

// find a move which 1) is safer than the move given and 2) when move is safe ==> the alternative is safe
function findAlternativeMove(actions) {

    const action = actions[0]  // the current best

    // if one of the common boxes contains a tile which has already been processed then the current tile is redundant
    for (let i = 1; i < actions.length; i++) {

        const alt = actions[i];

        if (alt.tile.safety - action.tile.safety > 0.001) {  // the alternative move is at least a bit safe than the current move
            for (let tile of action.commonClears) {  // see if the move is in the list of common safe tiles
                if (alt.tile.x == tile.x && alt.tile.y == tile.y) {
                    console.log("Replacing " + functions.tileAsText(action.tile) + " with " + functions.tileAsText(alt.tile) + " because it dominates");

                    // switch the alternative action with the best
                    actions[0] = alt;
                    actions[i] = action;

                    return;
                }
            }
        }
    }

    // otherwise return the order
    return;

}

function secondarySafetyAnalysis(globalOptions, pe, board, action, best) {

    const tile = action.tile;

    const safePe = runProbabilityEngine(globalOptions, board, [tile]);
    let linkedTilesCount = 0;
    let dominated = false;  // if tile 'a' being safe ==> tile 'b' & 'c' are safe and 'b' and 'c' are in the same box ==> 'b' is safer then 'a' 

    for (let box of safePe.emptyBoxes) {
        if (box.contains(tile)) { // if the tile is in this box then ignore it

        } else {
            if (box.tiles.length > 1) {
                dominated = true;
            } else {
                linkedTilesCount++;
            }
        }
    }

    if (globalOptions.verbose) {
        console.log("Tile " + functions.tileAsText(tile) + " has " + linkedTilesCount + " linked tiles and dominated=" + dominated);
    }

    // a dominated tile doesn't need any further resolution
    if (dominated) {
        action.weight = tile.safety * (1 + tile.safety* 0.1);
        action.commonClears = safePe.localClears;
        //console.log("Tile " + functions.tileAsText(tile) + " has weight " + action.weight);
        return;
    }

    let solutionsWithProgess = BigInt(0);
    let expectedClears = BigInt(0);
    let maxSolutions = BigInt(0);

    let secondarySafety = 0;
    let probThisTileLeft = tile.safety;  // this is used to calculate when we can prune this action

    // this is used to hold the tiles which are clears for all the possible values
    var commonClears = null;

    let adjFlags = 0;
    let adjCovered = 0;

    for (let adjTile of functions.adjacentIterator(board.width, board.height, board.allTiles, tile)) {
        if (adjTile.mine != null) {
            adjFlags++;
        } else if (adjTile.value == null) {
            adjCovered++;
        }
    }

    for (let value = adjFlags; value <= adjCovered + adjFlags; value++) {

        const progress = functions.divideBigInt(solutionsWithProgess, pe.finalSolutionsCount);
        const bonus = 1 + (progress + probThisTileLeft) * 0.1;
        const weight = (secondarySafety + probThisTileLeft) * bonus;

        if (best != null && weight < best.weight) {
            if (globalOptions.verbose) {
                console.log("Tile " + functions.tileAsText(tile) + " is being pruned");
            }
            action.weight = weight;
            action.pruned = true;

            if (tile.value != null) {
                delete tile.value;   // make sure we recover the tile
            }

            return;
        }

        tile.value = value;

        const work = runProbabilityEngine(globalOptions, board, null);
        const clearCount = work.localClears.length;

        if (work.finalSolutionsCount > 0) {  // if this is a valid board state
            if (commonClears == null) {
                commonClears = work.localClears;
            } else {
                commonClears = andClearTiles(commonClears, work.localClears);
            }

            const probThisTileValue = functions.divideBigInt(work.finalSolutionsCount, pe.finalSolutionsCount);
            secondarySafety = secondarySafety + probThisTileValue * work.bestProbability;

            if (globalOptions.verbose) {
                console.log("Tile " + functions.tileAsText(tile) + " with value " + value + " has probability " + probThisTileValue + ", secondary safety " + work.bestProbability + ", clears " + clearCount);
            }

            probThisTileLeft = probThisTileLeft - probThisTileValue;
        }

        //totalSolutions = totalSolutions + work.finalSolutionsCount;
        if (clearCount > 0) {
            expectedClears = expectedClears + work.finalSolutionsCount * BigInt(clearCount);

            if (clearCount > linkedTilesCount) {  // this is intended to penalise tiles which are linked to other tiles. Otherwise 2 tiles give each other all progress.
                solutionsWithProgess = solutionsWithProgess + work.finalSolutionsCount;
            }
        }

        if (work.finalSolutionsCount > maxSolutions) {
            maxSolutions = work.finalSolutionsCount;
        }

    }

    if (tile.value != null) {
        delete tile.value;   // make sure we recover the tile
    }

    action.expectedClears = functions.divideBigInt(expectedClears, pe.finalSolutionsCount);

    const progress = functions.divideBigInt(solutionsWithProgess, pe.finalSolutionsCount);

    action.weight = secondarySafety * (1 + progress * 0.1);
    action.commonClears = commonClears;

    if (globalOptions.verbose) {
        console.log("Tile " + functions.tileAsText(tile) + ", secondary safety = " + secondarySafety + ",  progress = " + progress + ", weight = " + action.weight + ", expected clears = " + action.expectedClears + ", common clears = " + commonClears.length);
    }
}


/*
 *  Look for pseudo 50/50s  
 */
function checkForPseudo5050(globalOptions, board, minesToFind) {

    const startTime = Date.now();

    for (let i = 0; i < board.width - 1; i++) {
        for (let j = 0; j < board.height; j++) {

            const index = i + j * board.width;

            const tile1 = board.allTiles[index];
            if (tile1.value != null || tile1.safety == 0) {  // cleared or a known mine
                continue;
            }

            const tile2 = board.allTiles[index + 1];  // this works because we don't go to the far right
            if (tile2.value != null || tile2.safety == 0) {  // cleared or a known mine
                continue;
            }

            // if information can come from any of the 6 tiles immediately right and left then can't be a 50-50 or pseudo 50/50
            if (isPotentialInfo(i - 1, j - 1) || isPotentialInfo(i - 1, j) || isPotentialInfo(i - 1, j + 1)
                || isPotentialInfo(i + 2, j - 1) || isPotentialInfo(i + 2, j) || isPotentialInfo(i + 2, j + 1)) {
                continue;  // this skips the rest of the logic below this in the for-loop 
            }

            // is both hidden tiles being mines a valid option?
            tile1.mine = true;
            tile2.mine = true;
            var counter = runProbabilityEngine(globalOptions, board, null);
            delete tile1.mine;
            delete tile2.mine;

            if (counter.finalSolutionsCount != 0) {
                //console.log(functions.tileAsText(tile1) + " and " + functions.tileAsText(tile2) + " can support 2 mines");
            } else {
                //console.log(functions.tileAsText(tile1) + " and " + functions.tileAsText(tile2) + " can not support 2 mines, we should guess here immediately");
                return tile1;
            }

        }
    }

    for (let i = 0; i < board.width; i++) {
        for (let j = 0; j < board.height - 1; j++) {

            const index = i + j * board.width;

            const tile1 = board.allTiles[index];
            if (tile1.value != null || tile1.safety == 0) {  // cleared or a known mine
                continue;
            }

            const tile2 = board.allTiles[index + board.width];  // this works because we don't go to the very bottom 
            if (tile2.value != null || tile2.safety == 0) {  // cleared or a known mine
                continue;
            }

            // if information can come from any of the 6 tiles immediately above and below then can't be a 50-50
            if (isPotentialInfo(i - 1, j - 1) || isPotentialInfo(i, j - 1) || isPotentialInfo(i + 1, j - 1)
                || isPotentialInfo(i - 1, j + 2) || isPotentialInfo(i, j + 2) || isPotentialInfo(i + 1, j + 2)) {
                continue;  // this skips the rest of the logic below this in the for-loop 
            }

            // is both hidden tiles being mines a valid option?
            tile1.mine = true;
            tile2.mine = true;
            var counter = runProbabilityEngine(globalOptions, board, null);
            delete tile1.mine;
            delete tile2.mine;

            if (counter.finalSolutionsCount != 0) {
                //console.log(functions.tileAsText(tile1) + " and " + functions.tileAsText(tile2) + " can support 2 mines");
            } else {
                //console.log(functions.tileAsText(tile1) + " and " + functions.tileAsText(tile2) + " can not support 2 mines, we should guess here immediately");
                return tile1;
            }

        }
    }

    // box 2x2
    const tiles = Array(4);

    for (let i = 0; i < board.width - 1; i++) {
        for (let j = 0; j < board.height - 1; j++) {

            const index = i + j * board.width;

            // need 4 hidden tiles in a 2x2 shape
            tiles[0] = board.allTiles[index];
            if (tiles[0].value != null || tiles[0].safety == 0) {
                continue;
            }

            tiles[1] = board.allTiles[index + 1];
            if (tiles[1].value != null || tiles[1].safety == 0) {
                continue;
            }

            tiles[2] = board.allTiles[index + board.width];
            if (tiles[2].value != null || tiles[2].safety == 0) {
                continue;
            }

            tiles[3] = board.allTiles[index + board.width + 1];
            if (tiles[3].value != null || tiles[3].safety == 0) {
                continue;
            }

            // need the outside corners to be flags
            if (isPotentialInfo(i - 1, j - 1) || isPotentialInfo(i + 2, j - 1) || isPotentialInfo(i - 1, j + 2) || isPotentialInfo(i + 2, j + 2)) {
                continue;  // this skips the rest of the logic below this in the for-loop 
            }

            //console.log(functions.tileAsText(tiles[0]) + " " + functions.tileAsText(tiles[1]) + " " + functions.tileAsText(tiles[2]) + " " + functions.tileAsText(tiles[3]) + " is candidate box 50/50");

            // keep track of which tiles are risky - once all 4 are then not a pseudo-50/50
            let riskyTiles = 0;
            const risky = Array(4).fill(false);

            // check each tile has a witness and that at least one is living
            let okay = true;
            let allDead = true;
            for (let l = 0; l < 4; l++) {
                if (tiles[l].dead == null) {
                    allDead = false;
                } else {
                    //riskyTiles++;
                    //risky[l] = true;  // since we'll never select a dead tile, consider them risky
                }

                if (tiles[l].offEdge) {
                    //console.log(functions.tileAsText(tiles[l]) + " has no witnesses");
                    okay = false;
                    break;
                }
            }
            if (!okay) {
                continue;
            }
            if (allDead) {
                //console.log("All tiles in the candidate are dead");
                continue
            }


            // some options aren't possible based on how many mines are left to find
            let start;
            if (minesToFind > 3) {
                start = 0;
            } else if (minesToFind == 3) {
                start = 1;
            } else if (minesToFind == 2) {
                start = 5;
            } else {
                start = 9;
            }

            for (let k = start; k < PeConstant.PSEUDO_5050_PATTERNS.length; k++) {

                const mines = [];
                const noMines = [];

                let run = false;
                // allocate each position as a mine or noMine
                for (let l = 0; l < 4; l++) {
                    if (PeConstant.PSEUDO_5050_PATTERNS[k][l]) {
                        mines.push(tiles[l]);
                        if (!risky[l]) {
                            run = true;
                        }
                    } else {
                        noMines.push(tiles[l]);
                    }
                }

                // only run if this pattern can discover something we don't already know
                if (!run) {
                    //console.log("Pattern " + k + " skipped");
                    continue;
                }

                // place the mines
                for (let tile of mines) {
                    tile.mine = true;
                }

                // see if the position is valid
                const counter = runProbabilityEngine(globalOptions, board, noMines);

                // remove the mines
                for (let tile of mines) {
                    delete tile.mine;
                }

                // if it is then mark each mine tile as risky
                if (counter.finalSolutionsCount != 0) {
                    //console.log("Pattern " + k + " is valid " + counter.finalSolutionsCount);
                    for (let l = 0; l < 4; l++) {
                        if (PeConstant.PSEUDO_5050_PATTERNS[k][l]) {
                            if (!risky[l]) {
                                risky[l] = true;
                                riskyTiles++;
                            }
                        }
                    }
                    if (riskyTiles == 4) {
                        break;
                    }
                } else {
                    //console.log("Pattern " + k + " is not valid");
                }
            }

            // if not all 4 tiles are risky then send back one which isn't
            if (riskyTiles != 4) {
                for (let l = 0; l < 4; l++) {
                    // if not risky and not dead then select it
                    if (!risky[l]) {
                        if (globalOptions.verbose) {
                            console.log(functions.tileAsText(tiles[0]) + " " + functions.tileAsText(tiles[1]) + " " + functions.tileAsText(tiles[2])
                                + " " + functions.tileAsText(tiles[3]) + " is pseudo 50/50 - " + functions.tileAsText(tiles[l]) + " is not risky");
                        }
                        return tiles[l];
                    }
                }
            }
        }
    }

    return null;

    // inner functions

    // returns whether there information to be had at this location; i.e. on the board and either unrevealed or revealed
    function isPotentialInfo(x, y) {

        if (x < 0 || x >= board.width || y < 0 || y >= board.height) {
            return false;
        }

        const index = x + y * board.width;

        if (board.allTiles[index].safety == 0) {  // mine
            return false;
        } else {
            return true;
        }

    }

}



function runProbabilityEngine(globalOptions, board, notMines) {

    // find all the tiles which are revealed and have un-revealed / un-flagged adjacent squares
    const coveredTiles = [];
    const witnesses = [];

    let minesToFind = board.mines;
    let coveredCount = 0;

    // find witnesses which still need work
    for (let i = 0; i < board.allTiles.length; i++) {

        const tile = board.allTiles[i];

        // if the tile is a mine nothing to do
        if (tile.mine != null) {
            minesToFind--;
            continue;
        }

        // if the tile is still covered then nothing to check
        if (tile.value == null) {
            coveredTiles.push(tile);  // covered tiles including mines
            coveredCount++;
            continue;
        }

        // count the number of covered adjacent tiles
        let adjCovered = 0;
        let adjMine = 0;
        for (let adjTile of functions.adjacentIterator(board.width, board.height, board.allTiles, tile)) {
            if (adjTile.value == null && adjTile.mine == null) {
                adjCovered++;
            } else if (adjTile.mine != null) {
                adjMine++;
            }
        }

        // if there are some covered tiles then this witness needs work, or if the adjacent Mines don't agree with the value 
        if (adjCovered != 0 || tile.value != adjMine) {
            witnesses.push(tile);  // if uncovered and not satisifed still work to do
        }
    }

    // get all the tiles adjacent to unsatisfied witnesses
    const work = new Set();  // use a set to deduplicate the witnessed tiles
    for (let tile of witnesses) {

        for (let adjTile of functions.adjacentIterator(board.width, board.height, board.allTiles, tile)) {
            if (adjTile.value == null && adjTile.mine == null) {   // not a mine and covered
                const index = adjTile.x + adjTile.y * board.width;
                work.add(index);
            }
        }

    }

    const witnessed = [];
    for (let index of work) {
        witnessed.push(board.allTiles[index]);
    }

    //console.log("tiles left = " + squaresLeft);
    //console.log("mines left = " + minesLeft);
    //console.log("Witnesses  = " + witnesses.length);
    //console.log("Witnessed  = " + witnessed.length);

    const options = {};
    options.verbose = false;
    options.deadTileAnalysis = globalOptions.allowDeadTileAnalysis;  // this will attempt to find dead tiles.  It is only correct to guess a dead tile if all the tiles are dead.
    options.apply = false;

    const pe = new ProbabilityEngine(board, witnesses, witnessed, coveredCount, minesToFind, options);

    // let the solution counter know which tiles mustn't contain mines
    if (notMines != null) {
        for (let tile of notMines) {
            pe.setMustBeEmpty(tile);
        }
    }

    pe.process();

    return pe;

}

function andClearTiles(tiles1, tiles2) {

    if (tiles1.length == 0) {
        return tiles1;
    }
    if (tiles2.length == 0) {
        return tiles2;
    }

    const result = [];
    for (let tile1 of tiles1) {
        for (let tile2 of tiles2) {
            if (tile2.x == tile1.x && tile2.y == tile1.y) {
                result.push(tile1);
                break;
            }
        }
    }

    return result;

}

//
//  Below here are the classes used by the solver
//


/**
 *  Binomial Coefficient calculator 
 *  Uses a fast algorithm for large coefficients
 *  Pre-calculates some binomial coefficients for speed
 **/

class Binomial {

    constructor(max, lookup) {

        const start = Date.now();

        this.max = max;

        this.ps = new PrimeSieve(this.max);

        if (lookup < 10) {
            lookup = 10;
        }
        this.lookupLimit = lookup;

        const lookup2 = lookup / 2;

        this.binomialLookup = Array(lookup + 1);

        for (let total = 1; total <= lookup; total++) {

            this.binomialLookup[total] = Array(lookup2 + 1);

            for (let choose = 0; choose <= total / 2; choose++) {
                this.binomialLookup[total][choose] = this.generate(choose, total);
            }

        }

        console.log("Binomial Coefficient generator initialised in " + (Date.now() - start) + " milliseconds");
    }


    generate(k, n) {

        if (n == 0 && k == 0) {
            return BigInt(1);
        }

        if (n < 1 || n > this.max) {
            throw new Error("Binomial: 1 <= n and n <= max required, but n was " + n + " and max was " + this.max);
        }

        if (0 > k || k > n) {
            throw new Error("Binomial: 0 <= k and k <= n required, but n was " + n + " and k was " + k);
        }

        const choose = Math.min(k, n - k);

        let answer;
        if (n <= this.lookupLimit) {
            answer = this.binomialLookup[n][choose];
        }

        if (answer != null) {
            return answer;
        } else if (choose < 25) {
            return this.combination(choose, n);
        } else {
            return this.combinationLarge(choose, n);
        }

    }

    combination(mines, squares) {

        let top = BigInt(1);
        let bot = BigInt(1);

        const range = Math.min(mines, squares - mines);

        // calculate the combination. 
        for (let i = 0; i < range; i++) {
            top = top * BigInt(squares - i);
            bot = bot * BigInt(i + 1);
        }

        const result = top / bot;

        return result;

    }


    combinationLarge(k, n) {

        if ((k == 0) || (k == n)) return BigInt(1);

        var n2 = n / 2;

        if (k > n2) {
            k = n - k;
        }

        var nk = n - k;

        var rootN = Math.floor(Math.sqrt(n));

        var result = BigInt(1);

        for (var prime = 2; prime <= n; prime++) {

            // we only want the primes
            if (!this.ps.isPrime(prime)) {
                continue;
            }

            if (prime > nk) {
                result = result * BigInt(prime);
                continue;
            }

            if (prime > n2) {
                continue;
            }

            if (prime > rootN) {
                if (n % prime < k % prime) {
                    result = result * BigInt(prime);
                }
                continue;
            }

            var r = 0;
            var N = n;
            var K = k;
            var p = 1;

            var safety = 500;
            while (N > 0) {
                r = (N % prime) < (K % prime + r) ? 1 : 0;
                if (r == 1) {
                    p *= prime;
                }
                N = Math.floor(N / prime);
                K = Math.floor(K / prime);
                //console.log("r=" + r + " N=" + N + " k=" + k + " p=" + p);
                safety--;
                if (safety < 1) {
                    throw new Error("Binomial coefficiant algorithm appears to be looping");
                }
            }
            if (p > 1) {
                result = result * BigInt(p);
            }
        }

        return result;
    }

}


/**
 * classic prime sieve algorithm to calculate the first n primes
 **/

class PrimeSieve {

    constructor(n) {

        if (n < 2) {
            this.max = 2;
        } else {
            this.max = n;
        }

        this.composite = Array(this.max).fill(false);

        const rootN = Math.floor(Math.sqrt(n));

        for (let i = 2; i < rootN; i++) {

            // if this is a prime number (not composite) then sieve the array
            if (!this.composite[i]) {
                let index = i + i;
                while (index <= this.max) {
                    this.composite[index] = true;
                    index = index + i;
                }
            }
        }

    }

    isPrime(n) {
        if (n <= 1 || n > this.max) {
            console.log("Prime check is out of range: " + n);
            throw new Error("Number to prime check is out of range: " + n);
        }

        return !this.composite[n];
    }

}

/*
 *  Probability engine and support classes 
 */

class ProbabilityEngine {

    static binomial = new Binomial(PeConstant.MAX_BINOMIAL_COEFFICIENT, PeConstant.BINOMIAL_CACHE_SIZE);  // pre calculate some binomial coefficients

	constructor(board, allWitnesses, allWitnessed, squaresLeft, minesLeft, options) {

        this.board = board;
        this.options = options;
        if (this.options.deadTileAnalysis == null) {
            this.options.deadTileAnalysis = false;
        }

		this.witnessed = allWitnessed;

        this.duration = 0;

        this.prunedWitnesses = [];  // a subset of allWitnesses with equivalent witnesses removed

        // constraints in the game
        this.minesLeft = minesLeft;
        this.tilesLeft = squaresLeft;
        this.TilesOffEdge = squaresLeft - allWitnessed.length;   // squares left off the edge and unrevealed
        this.minTotalMines = minesLeft - this.TilesOffEdge;   // //we can't use so few mines that we can't fit the remainder elsewhere on the board
        this.maxTotalMines = minesLeft;

        this.boxes = [];
        this.boxWitnesses = [];
        this.mask = [];

        // list of 'DeadCandidate' which are potentially dead
        this.deadCandidates = [];
        this.deadTiles = [];
        this.lonelyTiles = [];  // tiles with no empty space around them
        this.canDoDeadTileAnalysis = this.options.deadTileAnalysis;

        this.emptyBoxes = [];  // boxes which never contain mines - i.e. the set of safe tiles by Box
        this.localClears = [];

		this.workingProbs = []; 
        this.heldProbs = [];
        this.bestProbability = 0;  // best probability of being safe
        this.offEdgeProbability = 0;
        this.bestOnEdgeProbability;
        this.finalSolutionsCount = BigInt(0);

        // details about independent witnesses - used by the brute force processing
        this.independentWitnesses = [];
        this.dependentWitnesses = [];
        this.independentMines = 0;
        this.independentIterations = BigInt(1);
        this.remainingSquares = 0;

        // if we have an isolated edge then the iterator for it is here
        this.isolatedEdgeBruteForce = null;

        this.answer = [];

        this.validWeb = true;

        // can't have less than zero mines
        if (minesLeft < 0) {
            this.validWeb = false;
            return;
        }

        // generate a BoxWitness for each witness tile and also create a list of pruned witnesses for the brute force search
        let pruned = 0;
        for (let i = 0; i < allWitnesses.length; i++) {
            const wit = allWitnesses[i];

            const boxWit = new BoxWitness(this.board, wit);

            // can't have too many or too few mines 
            if (boxWit.minesToFind < 0 || boxWit.minesToFind > boxWit.tiles.length) {
                this.validWeb = false;
            }

            // if the witness is a duplicate then don't store it
            let duplicate = false;
            for (let j = 0; j < this.boxWitnesses.length; j++) {

                const w = this.boxWitnesses[j];

                if (w.equivalent(boxWit)) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) {
                this.prunedWitnesses.push(boxWit);
             } else {
                pruned++;
            }
            this.boxWitnesses.push(boxWit);  // all witnesses are needed for the probability engine
        }
        this.writeToConsole("Pruned " + pruned + " witnesses as duplicates");
        this.writeToConsole("There are " + this.boxWitnesses.length + " Box witnesses");

		// allocate each of the witnessed squares to a box
		let uid = 0;
		for (let i=0; i < this.witnessed.length; i++) {
			
			const tile = this.witnessed[i];
			
			let count = 0;
			
			// count how many adjacent witnesses the tile has
			for (let j=0; j < allWitnesses.length; j++) {
                if (functions.isAdjacent(tile, allWitnesses[j])) {
					count++;
				}
			}
			
            // see if the witnessed tile fits any existing boxes
            let found = false;
			for (let j=0; j < this.boxes.length; j++) {
				
				if (this.boxes[j].fits(tile, count)) {
					this.boxes[j].add(tile);
					found = true;
					break;
				}
				
			}
			
			// if not found create a new box and store it
			if (!found) {
                this.boxes.push(new Box(this.boxWitnesses, tile, uid++));
			}

        }

        // calculate the min and max mines for each box 
        for (let i = 0; i < this.boxes.length; i++) {
            const box = this.boxes[i];
            box.calculate(this.minesLeft);
            //console.log("Box " + box.tiles[0].asText() + " has min mines = " + box.minMines + " and max mines = " + box.maxMines);
        }

        // Report how many boxes each witness is adjacent to 
        //for (let i = 0; i < this.boxWitnesses.length; i++) {
        //    const boxWit = this.boxWitnesses[i];
        //    console.log("Witness " + boxWit.tile.asText() + " is adjacent to " + boxWit.boxes.length + " boxes and has " + boxWit.minesToFind + " mines to find");
        //}

 	}

    // calculate a probability for each un-revealed tile on the board
	process() {

        // if the board isn't valid then solution count is zero
        if (!this.validWeb) {
            this.finalSolutionsCount = BigInt(0);
            return;
        }

        const peStart = Date.now();

        // create an array showing which boxes have been procesed this iteration - none have to start with
        this.mask = Array(this.boxes.length).fill(false);

        // look for places which could be dead
        if (this.options.deadTileAnalysis) {
            this.getCandidateDeadLocations();
        }

 		// create an initial solution of no mines anywhere 
        this.heldProbs.push(new ProbabilityLine(this.boxes.length, BigInt(1)));
		
		// add an empty probability line to get us started
        this.workingProbs.push(new ProbabilityLine(this.boxes.length, BigInt(1)));
		
        let nextWitness = this.findFirstWitness();

        while (nextWitness != null) {

            // mark the new boxes as processed - which they will be soon
            for (let i = 0; i < nextWitness.newBoxes.length; i++) {
                this.mask[nextWitness.newBoxes[i].uid] = true;
            }

            this.workingProbs = this.mergeProbabilities(nextWitness);

            nextWitness = this.findNextWitness();

        }

        //this.calculateBoxProbabilities();

        // if this isn't a valid board than nothing to do
        if (this.heldProbs.length != 0) {
            this.calculateBoxProbabilities();
        } else {
            this.finalSolutionsCount = BigInt(0);
        }

        this.duration = Date.now() - peStart;

        this.writeToConsole("Duration " + this.duration + " milliseconds");
		
	}


    // take the next witness details and merge them into the currently held details
    mergeProbabilities(nw) {

        const newProbs = [];

        for (let i = 0; i < this.workingProbs.length; i++) {

            const pl = this.workingProbs[i];

            var missingMines = nw.boxWitness.minesToFind - this.countPlacedMines(pl, nw);

            if (missingMines < 0) {
                //console.log("Missing mines < 0 ==> ignoring line");
                // too many mines placed around this witness previously, so this probability can't be valid
            } else if (missingMines == 0) {
                //console.log("Missing mines = 0 ==> keeping line as is");
                newProbs.push(pl);   // witness already exactly satisfied, so nothing to do
            } else if (nw.newBoxes.length == 0) {
                //console.log("new boxes = 0 ==> ignoring line since nowhere for mines to go");
                // nowhere to put the new mines, so this probability can't be valid
            } else {
                
                const result = this.distributeMissingMines(pl, nw, missingMines, 0);
                newProbs.push(...result);

            }

        }

        // flag the last set of details as processed
        nw.boxWitness.processed = true;

        for (var i = 0; i < nw.newBoxes.length; i++) {
            nw.newBoxes[i].processed = true;
        }

        //if we haven't compressed yet and we are still a small edge then don't compress
        if (newProbs.length < 100 && this.canDoDeadTileAnalysis) {
            return newProbs;
        }

        // about to compress the line
        this.canDoDeadTileAnalysis = false;

        // about to compress the lines
        const boundaryBoxes = [];
        for (let i = 0; i < this.boxes.length; i++) {
            const box = this.boxes[i];
            let notProcessed = false;
            let processed = false;
            for (let j = 0; j < box.boxWitnesses.length; j++) {
                if (box.boxWitnesses[j].processed) {
                    processed = true;
                } else {
                    notProcessed = true;
                }
                if (processed && notProcessed) {
                    boundaryBoxes.push(box);
                    break;
                }
            }
        }
 
        const sorter = new MergeSorter(boundaryBoxes);

        const result = this.crunchByMineCount(newProbs, sorter);

        return result;

    }

    // counts the number of mines already placed
    countPlacedMines(pl, nw) {

        let result = 0;

        for (let i = 0; i < nw.oldBoxes.length; i++) {

            const b = nw.oldBoxes[i];

            result = result + pl.allocatedMines[b.uid];
        }

        return result;
    }

    // this is used to recursively place the missing Mines into the available boxes for the probability line
    distributeMissingMines(pl, nw,  missingMines, index) {

        //console.log("Distributing " + missingMines + " missing mines to box " + nw.newBoxes[index].uid);

        this.recursions++;
        if (this.recursions % 1000 == 0) {
            console.log("Probability Engine recursision at " + recursions);
        }

        const result = [];

        // if there is only one box left to put the missing mines we have reach the end of this branch of recursion
        if (nw.newBoxes.length - index == 1) {
            // if there are too many for this box then the probability can't be valid
            if (nw.newBoxes[index].maxMines < missingMines) {
                //console.log("Abandon (1)");
                return result;
            }
            // if there are too few for this box then the probability can't be valid
            if (nw.newBoxes[index].minMines > missingMines) {
                //console.log("Abandon (2)");
                return result;
            }
            // if there are too many for this game then the probability can't be valid
            if (pl.mineCount + missingMines > this.maxTotalMines) {
                //console.log("Abandon (3)");
                return result;
            }

            // otherwise place the mines in the probability line
            result.push(this.extendProbabilityLine(pl, nw.newBoxes[index], missingMines));
            //console.log("Distribute missing mines line after " + pl.mineBoxCount);
            return result;
        }


        // this is the recursion
        const maxToPlace = Math.min(nw.newBoxes[index].maxMines, missingMines);

        for (let i = nw.newBoxes[index].minMines; i <= maxToPlace; i++) {
            const npl = this.extendProbabilityLine(pl, nw.newBoxes[index], i);

            const r1 = this.distributeMissingMines(npl, nw, missingMines - i, index + 1);
            result.push(...r1);

        }

        return result;

    }

    // create a new probability line by taking the old and adding the mines to the new Box
    extendProbabilityLine(pl, newBox, mines) {

        //console.log("Extended probability line: Adding " + mines + " mines to box " + newBox.uid);
        //console.log("Extended probability line before" + pl.mineBoxCount);

        const combination = PeConstant.SMALL_COMBINATIONS[newBox.tiles.length][mines];
        const bigCom = BigInt(combination);

        const newSolutionCount = pl.solutionCount * bigCom;

        const result = new ProbabilityLine(this.boxes.length, newSolutionCount);

        result.mineCount = pl.mineCount + mines;
 
        // copy the probability array

        if (combination != 1) {
            for (let i = 0; i < pl.mineBoxCount.length; i++) {
                result.mineBoxCount[i] = pl.mineBoxCount[i] * bigCom;
            }
        } else {
            result.mineBoxCount = pl.mineBoxCount.slice();
        }

        result.mineBoxCount[newBox.uid] = BigInt(mines) * result.solutionCount;

        result.allocatedMines = pl.allocatedMines.slice();
        result.allocatedMines[newBox.uid] = mines;

        //console.log("Extended probability line after " + result.mineBoxCount);

        return result;
    }


    // this combines newly generated probabilities with ones we have already stored from other independent sets of witnesses
    storeProbabilities() {

         const result = [];

        if (this.workingProbs.length == 0) {
            this.heldProbs = [];
        	return;
        } 

        // if the number of mines is constant check if we have an isolated edge
        if (this.workingProbs.length == 1) {
            this.checkEdgeIsIsolated();
        }

        for (let i = 0; i < this.workingProbs.length; i++) {

            const pl = this.workingProbs[i];

            for (let j = 0; j < this.heldProbs.length; j++) {

                const epl = this.heldProbs[j];

                const npl = new ProbabilityLine(this.boxes.length);

                npl.mineCount = pl.mineCount + epl.mineCount;

                if (npl.mineCount <= this.maxTotalMines) {

                    npl.solutionCount = pl.solutionCount * epl.solutionCount;

                    for (let k = 0; k < npl.mineBoxCount.length; k++) {

                        const w1 = pl.mineBoxCount[k] * epl.solutionCount;
                        const w2 = epl.mineBoxCount[k] * pl.solutionCount;
                        npl.mineBoxCount[k] = w1 + w2;

                    }
                    result.push(npl);

                }
            }
        }

        // sort into mine order 
        result.sort(function (a, b) { return a.mineCount - b.mineCount });

        this.heldProbs = [];

        // if result is empty this is an impossible position
        if (result.length == 0) {
            return;
        }

        // and combine them into a single probability line for each mine count
        let mc = result[0].mineCount;
        let npl = new ProbabilityLine(this.boxes.length);
        npl.mineCount = mc;

        for (let i = 0; i < result.length; i++) {

            const pl = result[i];

            if (pl.mineCount != mc) {
                this.heldProbs.push(npl);
                mc = pl.mineCount;
                npl = new ProbabilityLine(this.boxes.length);
                npl.mineCount = mc;
            }
            npl.solutionCount = npl.solutionCount + pl.solutionCount;

            for (let j = 0; j < pl.mineBoxCount.length; j++) {
                npl.mineBoxCount[j] = npl.mineBoxCount[j] + pl.mineBoxCount[j];
            }
        }

        this.heldProbs.push(npl);

    }

    crunchByMineCount(target, sorter) {

        if (target.length == 0) {
            return target;
         }

        // sort the solutions by number of mines
        target.sort(function (a, b) { return sorter.compare(a,b) });

        const result = [];

        let current = null;

        for (let i = 0; i < target.length; i++) {

            const pl = target[i];

            if (current == null) {
                current = target[i];
            } else if (sorter.compare(current, pl) != 0) {
                result.push(current);
                current = pl;
            } else {
                this.mergeLineProbabilities(current, pl);
            }

        }

        result.push(current);
 
        this.writeToConsole(target.length + " Probability Lines compressed to " + result.length); 

        return result;

    }

    // calculate how many ways this solution can be generated and roll them into one
    mergeLineProbabilities(npl, pl) {

        npl.solutionCount = npl.solutionCount + pl.solutionCount;

        for (let i = 0; i < pl.mineBoxCount.length; i++) {
            if (this.mask[i]) {  // if this box has been involved in this solution
                npl.mineBoxCount[i] = npl.mineBoxCount[i] + pl.mineBoxCount[i];
            }

        }

    }

    // return any witness which hasn't been processed
    findFirstWitness() {

        for (let i = 0; i < this.boxWitnesses.length; i++) {
            const boxWit = this.boxWitnesses[i];
            if (!boxWit.processed) {
                return new NextWitness(boxWit);
            }
        }

        return null;
    }

    // look for the next witness to process
    findNextWitness() {

        let bestTodo = 99999;
        let bestWitness = null;

        // and find a witness which is on the boundary of what has already been processed
        for (let i = 0; i < this.boxes.length; i++) {
            const b = this.boxes[i];
            if (b.processed) {
                for (let j = 0; j < b.boxWitnesses.length; j++) {
                    const w = b.boxWitnesses[j];
                    if (!w.processed) {
                        let todo = 0;
                        for (let k = 0; k < w.boxes.length; k++) {
                            const b1 = w.boxes[k];

                            if (!b1.processed) {
                                todo++;
                            }
                        }
                        if (todo == 0) {    // prioritise the witnesses which have the least boxes left to process
                            return new NextWitness(w);
                        } else if (todo < bestTodo) {
                            bestTodo = todo;
                            bestWitness = w;
                        }
                    }
                }
            }
        }

        if (bestWitness != null) {
            return new NextWitness(bestWitness);
        } else {
            this.writeToConsole("Ending independent edge");
        }

        // if we are down here then there is no witness which is on the boundary, so we have processed a complete set of independent witnesses 

        // see if any of the tiles on this edge are dead
        this.checkCandidateDeadLocations(this.canDoDeadTileAnalysis);

        // if we haven't compressed yet then do it now
        if (this.canDoDeadTileAnalysis) {
            const sorter = new MergeSorter();
            this.workingProbs = this.crunchByMineCount(this.workingProbs, sorter);
        } else {
            this.canDoDeadTileAnalysis = this.options.deadTileAnalysis;
        }


        // get an unprocessed witness
        const nw = this.findFirstWitness();
        if (nw != null) {
            this.writeToConsole("Starting a new independent edge");
        }

 
        this.storeProbabilities();

        // reset the working array so we can start building up one for the new set of witnesses
        this.workingProbs = [new ProbabilityLine(this.boxes.length, BigInt(1))];

        // reset the mask indicating that no boxes have been processed 
        this.mask.fill(false);
 
        // return the next witness to process
        return nw;

    }

    // here we expand the localised solution to one across the whole board and
    // sum them together to create a definitive probability for each box
    calculateBoxProbabilities() {

        const tally = [];
        for (let i = 0; i < this.boxes.length; i++) {
            tally[i] = BigInt(0);
        }

        // total game tally
        let totalTally = BigInt(0);

        // outside a box tally
        let outsideTally = BigInt(0);

        // calculate how many mines 
        for (let i = 0; i < this.heldProbs.length; i++) {

            const pl = this.heldProbs[i];

            //console.log("Mine count is " + pl.mineCount + " with solution count " + pl.solutionCount + " mineBoxCount = " + pl.mineBoxCount);

            if (pl.mineCount >= this.minTotalMines) {    // if the mine count for this solution is less than the minimum it can't be valid

                var mult = ProbabilityEngine.binomial.generate(this.minesLeft - pl.mineCount, this.TilesOffEdge);

                outsideTally = outsideTally + mult * BigInt(this.minesLeft - pl.mineCount) * (pl.solutionCount);

                // this is all the possible ways the mines can be placed across the whole game
                totalTally = totalTally + mult * (pl.solutionCount);

                for (let j = 0; j < tally.length; j++) {
                    //console.log("mineBoxCount " + j + " is " + pl.mineBoxCount[j]);
                    tally[j] = tally[j] + (mult * pl.mineBoxCount[j]) / BigInt(this.boxes[j].tiles.length);
                }
            }

        }

         // for each box calculate a probability
        for (let i = 0; i < this.boxes.length; i++) {

            const box = this.boxes[i];

            if (totalTally != 0) {
                if (tally[i] == totalTally) {  // a mine
                    box.safety = 0;

                } else if (tally[i] == 0) {  // safe
                    box.safety = 1;

                    this.emptyBoxes.push(box);
                    this.localClears.push(...box.tiles);

                } else {  // neither mine nor safe
                    box.safety = (1 - functions.divideBigInt(tally[i], totalTally, 6)).toFixed(6);

                }

            } else {
                box.safety = 0;
            }

            // assign the probabilities to the boxes and the tiles
            if (this.options.apply) {
                for (let tile of box.tiles) {
                    tile.safety = box.safety;
                    this.answer.push(tile);
                }
            }
        }

        // mark the dead tiles
        for (let i = 0; i < this.lonelyTiles.length; i++) {
            const dc = this.lonelyTiles[i];
            if (!dc.isAlive && dc.candidate.safety != 0 && dc.candidate.safety != 1) {  // not alive, safe or a mine
                if (this.options.apply) {
                    dc.candidate.dead = true;
                }
                this.deadTiles.push(dc.candidate);
                this.writeToConsole("Found Lonely tile " + functions.tileAsText(dc.candidate) + " is dead with value +" + dc.total);
            }
        }
        for (let i = 0; i < this.deadCandidates.length; i++) {
            const dc = this.deadCandidates[i];
            if (!dc.isAlive && dc.candidate.safety != 0 && dc.candidate.safety != 1) {  // not alive, safe or a mine
                if (this.options.apply) {
                    dc.candidate.dead = true;
                }
                this.deadTiles.push(dc.candidate);
                this.writeToConsole("Found " + functions.tileAsText(dc.candidate) + " to be dead with value +" + dc.total);
            }
        }
 

        // avoid divide by zero
        if (this.TilesOffEdge != 0 && totalTally != BigInt(0)) {
            this.offEdgeProbability = 1 - functions.divideBigInt(outsideTally, totalTally * BigInt(this.TilesOffEdge), 6);
        } else {
            this.offEdgeProbability = 0;
        }

        this.finalSolutionsCount = totalTally;

        // see if we can find a guess which is better than outside the boxes

        const orderedBoxes = [...this.boxes];
        orderedBoxes.sort(function (a, b) { return b.safety - a.safety });

        let hwm = 0;
        let allDead = true;
        top: for (const box of orderedBoxes) {

            for (const tile of box.tiles) {
                let living = true;
                for (const deadTile of this.deadTiles) {
                    if (tile.x == deadTile.x && tile.y == deadTile.y) {
                        living = false;
                        break;
                    }
                }
                if (living) {
                    hwm = box.safety;
                    allDead = false;
                    break top;
                }
            }
        }
        if (allDead) {
            if (orderedBoxes.length != 0) {
                hwm = orderedBoxes[0].safety;
            } else {
                hwm = 0;
            }
        }

        this.bestOnEdgeProbability = hwm;

        this.bestProbability = Math.max(this.bestOnEdgeProbability, this.offEdgeProbability);            ;

        this.writeToConsole("Off edge probability is " + this.offEdgeProbability);
        this.writeToConsole("Best on edge probability is " + this.bestOnEdgeProbability);
        this.writeToConsole("Best probability is " + this.bestProbability);
        this.writeToConsole("Game has  " + this.finalSolutionsCount + " candidate solutions" );

        this.fullAnalysis = true;
 
    }

    // an edge is isolated if every tile on it is completely surrounded by boxes also on the same edge
    checkEdgeIsIsolated() {

        const edgeTiles = new Set();
        const edgeWitnesses = new Set();

        let everything = true;

        // there is only 1 probability line and this is it
        const pl = this.workingProbs[0];

        // load each tile on this edge into a set
        for (let i = 0; i < this.mask.length; i++) {
            if (this.mask[i]) {
                if (pl.mineBoxCount[i] == 0) {
                    this.writeToConsole("Edge has safe tiles isolation check not needed");
                    return false;
                }

                 for (let j = 0; j < this.boxes[i].tiles.length; j++) {
                    edgeTiles.add(this.boxes[i].tiles[j]);
                }

                for (let j = 0; j < this.boxes[i].boxWitnesses.length; j++) {
                    edgeWitnesses.add(this.boxes[i].boxWitnesses[j].tile);
                }

            } else {
                everything = false;
            }
        }

        //var text = "";
        //for (var i = 0; i < edgeTiles.size; i++) {
        //    text = text + edgeTiles[i].asText() + " ";
        //}
        //console.log(text);

        // if this edge is everything then it isn't an isolated edge
        //if (everything) {
        //    this.writeToConsole("Not isolated because the edge is everything");
        //    return false;
        //}

        if (this.isolatedEdgeBruteForce != null && edgeTiles.size >= this.isolatedEdgeBruteForce.tiles.length) {
            this.writeToConsole("Already found an isolated edge of smaller size");
        }

        // check whether every tile adjacent to the tiles on the edge is itself on the edge
        for (let i = 0; i < this.mask.length; i++) {
            if (this.mask[i]) {
                for (let j = 0; j < this.boxes[i].tiles.length; j++) {
                    const tile = this.boxes[i].tiles[j];
                    for (let adjTile of functions.adjacentIterator(this.board.width, this.board.height, this.board.allTiles, tile)) {
                        if (adjTile.value == null && adjTile.mine == null && !edgeTiles.has(adjTile)) {
                            this.writeToConsole("Not isolated because a tile's adjacent tiles isn't on the edge: " + functions.tileAsText(tile) + " ==> " + functions.tileAsText(adjTile));
                            return false;
                        }
                    }
                }
            }
        }

        this.writeToConsole("Isolated Edge found");

        const tiles = [...edgeTiles];
        const witnesses = [...edgeWitnesses];
        const mines = this.workingProbs[0].mineCount;

        if (mines == 0) {
            this.writeToConsole("Isolated edge has no mines, nothing to discover");
            return false;
        }

        // build a web of the isolated edge and use it to build a brute force
        const isolatedEdge = new ProbabilityEngine(this.board, witnesses, tiles, tiles.length, mines, this.options);
        isolatedEdge.generateIndependentWitnesses();
        const iterator = new WitnessWebIterator(isolatedEdge, tiles, -1);

        if (iterator.cycles > PeConstant.BRUTE_FORCE_CYCLES_THRESHOLD) {
            this.writeToConsole("Isolated edge requires too many cycles " + iterator.cycles);
            return false;

        }

        const bruteForce = new Cruncher(this.board, iterator);

        this.isolatedEdgeBruteForce = bruteForce;

        return true;
    }

    // determine a set of independent witnesses which can be used to brute force the solution space more efficiently then a basic 'pick r from n' 
    generateIndependentWitnesses() {

        this.remainingSquares = this.witnessed.length;

        // find a set of witnesses which don't share any squares (there can be many of these, but we just want one to use with the brute force iterator)
        for (let i = 0; i < this.prunedWitnesses.length; i++) {

            const w = this.prunedWitnesses[i];

            //console.log("Checking witness " + w.tile.asText() + " for independence");

            let okay = true;
            for (let j = 0; j < this.independentWitnesses.length; j++) {

                const iw = this.independentWitnesses[j];

                if (w.overlap(iw)) {
                    okay = false;
                    break;
                }
            }

            // split the witnesses into dependent ones and independent ones 
            if (okay) {
                this.remainingSquares = this.remainingSquares - w.tiles.length;
                this.independentIterations = this.independentIterations * ProbabilityEngine.binomial.generate(w.minesToFind, w.tiles.length);
                this.independentMines = this.independentMines + w.minesToFind;
                this.independentWitnesses.push(w);
                console.log(functions.tileAsText(w.tile) + " is an independent witness");
            } else {
                this.dependentWitnesses.push(w);
            }
        }

        this.writeToConsole("Calculated " + this.independentWitnesses.length + " independent witnesses leaving " + this.independentMines + " mines");

    }

    // find tiles which could be dead (if not a mine then their value is known)
    getCandidateDeadLocations() {

        // for each square on the edge
        for (let i = 0; i < this.witnessed.length; i++) {

            const tile = this.witnessed[i];

            const adjBoxes = this.getAdjacentBoxes(tile);

            if (adjBoxes == null) {  // this happens when the square isn't fully surrounded by boxes
                continue;
            }

            const dc = new DeadCandidate();
            dc.candidate = tile;
            dc.myBox = this.getBox(tile);

            for (let j = 0; j < adjBoxes.length; j++) {

                const box = adjBoxes[j];

                let good = true;
                for (let k = 0; k < box.tiles.length; k++) {

                    const square = box.tiles[k];

                    if (!functions.isAdjacent(square, tile) && !(square.x == tile.x && square.y == tile.y)) {
                        good = false;
                        break;
                    }
                }
                if (good) {
                    dc.goodBoxes.push(box);
                } else {
                    dc.badBoxes.push(box);
                }

            }

            if (dc.goodBoxes.length == 0 && dc.badBoxes.length == 0) {
                this.writeToConsole(functions.tileAsText(dc.candidate) + " is lonely since it has no open tiles around it");
                this.lonelyTiles.push(dc);
            } else {
                this.deadCandidates.push(dc);
            }

        }

        for (let i = 0; i < this.deadCandidates.length; i++) {
            const dc = this.deadCandidates[i];
            this.writeToConsole(functions.tileAsText(dc.candidate) + " is candidate dead with " + dc.goodBoxes.length + " good boxes and " + dc.badBoxes.length + " bad boxes");
        }

    }

    // check the candidate dead locations with the information we have - remove those that aren't dead
    checkCandidateDeadLocations(checkPossible) {

        let completeScan;
        if (this.TilesOffEdge == 0) {
            completeScan = true;   // this indicates that every box has been considered in one sweep (only 1 independent edge)
            for (let i = 0; i < this.mask.length; i++) {
                if (!this.mask[i]) {
                    completeScan = false;
                    break;
                }
            }
            if (completeScan) {
                this.writeToConsole("This is a complete scan");
            } else {
                this.writeToConsole("This is not a complete scan");
            }
        } else {
            completeScan = false;
            this.writeToConsole("This is not a complete scan because there are squares off the edge");
        }


        for (let i = 0; i < this.deadCandidates.length; i++) {

            const dc = this.deadCandidates[i];

            if (dc.isAlive) {  // if this location isn't dead then no need to check any more
                continue;
            }

            // only do the check if all the boxes have been analysed in this probability iteration
            let boxesInScope = 0;
            for (let j = 0; j < dc.goodBoxes.length; j++) {
                const b = dc.goodBoxes[j];
                if (this.mask[b.uid]) {
                    boxesInScope++;
                }
            }
            for (let j = 0; j < dc.badBoxes.length; j++) {
                const b = dc.badBoxes[j];
                if (this.mask[b.uid]) {
                    boxesInScope++;
                }
            }
            if (boxesInScope == 0) {
                continue;
            } else if (boxesInScope != dc.goodBoxes.length + dc.badBoxes.length) {
                this.writeToConsole("Location " + functions.tileAsText(dc.candidate) + " has some boxes in scope and some out of scope so assumed alive");
                dc.isAlive = true;
                continue;
            }

            //if we can't do the check because the edge has been compressed mid process then assume alive
            if (!checkPossible) {
                this.writeToConsole("Location " + functions.tileAsText(dc.candidate) + " was on compressed edge so assumed alive");
                dc.isAlive = true;
                continue;
            }

            let okay = true;
            let mineCount = 0;
            line: for (let j = 0; j < this.workingProbs.length; j++) {

                const pl = this.workingProbs[j];

                if (completeScan && pl.mineCount != this.minesLeft) {
                    continue line;
                }

                // ignore probability lines where the candidate is a mine
                if (pl.allocatedMines[dc.myBox.uid] == dc.myBox.tiles.length) {
                    mineCount++;
                    continue line;
                }

                // all the bad boxes must be zero
                for (let k = 0; k < dc.badBoxes.length; k++) {

                    const b = dc.badBoxes[k];

                    let neededMines;
                    if (b.uid == dc.myBox.uid) {
                        neededMines = BigInt(b.tiles.length - 1) * pl.solutionCount;
                    } else {
                        neededMines = BigInt(b.tiles.length) * pl.solutionCount;
                    }

                    // a bad box must have either no mines or all mines
                    if (pl.mineBoxCount[b.uid] != 0 && pl.mineBoxCount[b.uid] != neededMines) {
                        this.writeToConsole("Location " + functions.tileAsText(dc.candidate) + " is not dead because a bad box has neither zero or all mines: " + pl.mineBoxCount[b.uid] + "/" + neededMines);
                        okay = false;
                        break line;
                    }
                }

                let tally = 0;
                // the number of mines in the good boxes must always be the same
                for (let k = 0; k < dc.goodBoxes.length; k++) {
                    const b = dc.goodBoxes[k];
                    tally = tally + pl.allocatedMines[b.uid];
                }
                //boardState.display("Location " + dc.candidate.display() + " has mine tally " + tally);
                if (dc.firstCheck) {
                    dc.total = tally;
                    dc.firstCheck = false;
                } else {
                    if (dc.total != tally) {
                        this.writeToConsole("Location " + functions.tileAsText(dc.candidate) + " is not dead because the sum of mines in good boxes is not constant. Was "
                            + dc.total + " now " + tally + ". Mines in probability line " + pl.mineCount);
                        okay = false;
                        break;
                    }
                }
            }

            // if a check failed or every this tile is a mine for every solution then it is alive
            if (!okay || mineCount == this.workingProbs.length) {
                dc.isAlive = true;
            }

        }

    }

    // get the box containing this tile
    getBox(tile) {

        for (let i = 0; i < this.boxes.length; i++) {
            if (this.boxes[i].contains(tile)) {
                return this.boxes[i];
            }
        }

        return null;
    }

    // return all the boxes adjacent to this tile
    getAdjacentBoxes(loc) {

        const result = [];

        //const adjLocs = this.board.getAdjacent(loc);

        // get each adjacent location
        for (let adjLoc of functions.adjacentIterator(this.board.width, this.board.height, this.board.allTiles, loc)) {

            //let adjLoc = adjLocs[i];

            // we only want adjacent tile which are un-revealed
            if (adjLoc.value != null || adjLoc.mine) {
                continue;
            }

            // find the box it is in
            let boxFound = false;
            for (let j = 0; j < this.boxes.length; j++) {

                const box = this.boxes[j];

                if (box.contains(adjLoc)) {
                    boxFound = true;
                    // is the box already included?
                    let found = false;
                    for (let k = 0; k < result.length; k++) {

                        if (box.uid == result[k].uid) {
                            found = true;
                            break;
                        }
                    }
                    // if not add it
                    if (!found) {
                        result.push(box);
                    }
                }
            }

            // if a box can't be found for the adjacent square then the location can't be dead
            if (!boxFound) {
                return null;
            }

        }

        return result;

    }

    // forces a box to contain a tile which isn't a mine.  If the location isn't in a box false is returned.
    setMustBeEmpty(tile) {

        const box = this.getBox(tile);

        if (box == null) {
            this.validWeb = false;
            return false;
        } else {
            box.incrementEmptyTiles();
        }

        return true;

    }

    checkForUnavoidable5050() {

        this.writeToConsole("Looking for 2-tile (or extended) 50/50");

        const links = [];

        for (let i = 0; i < this.prunedWitnesses.length; i++) {
            const witness = this.prunedWitnesses[i];

            if (witness.minesToFind == 1 && witness.tiles.length == 2) {

                // create a new link
                const link = new Link();
                link.tile1 = witness.tiles[0];
                link.tile2 = witness.tiles[1];

                //console.log("Witness " + witness.tile.asText() + " is a possible unavoidable guess witness");
                let unavoidable = true;
                // if every monitoring tile also monitors all the other tiles then it can't provide any information
                for (let j = 0; j < witness.tiles.length; j++) {
                    const tile = witness.tiles[j];

                    // get the witnesses monitoring this tile
                    for (let adjTile of functions.adjacentIterator(this.board.width, this.board.height, this.board.allTiles, tile)) {

                        // ignore tiles which are mines 
                        if (adjTile.mine != null || adjTile.safety == 0) {
                            continue;
                        }

                        // are we one of the tiles other tiles, if so then no need to check
                        let toCheck = true;
                        for (let otherTile of witness.tiles) {
                            if (otherTile.x == adjTile.x && otherTile.y == adjTile.y) {
                                toCheck = false;
                                break;
                            }
                        }

                        // if we are monitoring and not a mine then see if we are also monitoring all the other mines
                        if (toCheck) {
                            for (let otherTile of witness.tiles) {
                                if (!functions.isAdjacent(adjTile, otherTile)) {

                                    //console.log("Tile " + adjTile.asText() + " is not monitoring all the other witnessed tiles");
                                    link.trouble.push(adjTile);
                                    if (tile.x == link.tile1.x && tile.y == link.tile1.y) {
                                        link.closed1 = false;
                                    } else {
                                        link.closed2 = false;
                                    }

                                    unavoidable = false;
                                    //break check;
                                }
                            }
                        }
                    }
                }
                if (unavoidable) {
                    this.writeToConsole("Tile " + functions.tileAsText(witness.tile) + " is an unavoidable guess");
                    return witness.tiles[0];
                }

                links.push(link);
            }
        }

        // this is the area the 50/50 spans
        let area5050 = [];

        // try and connect 2 or links together to form an unavoidable 50/50
        for (let link of links) {
            if (!link.processed && (link.closed1 && !link.closed2 || !link.closed1 && link.closed2)) {  // this is the XOR operator, so 1 and only 1 of these is closed 

                let openTile;
                let extensions = 0;
                if (!link.closed1) {
                    openTile = link.tile1;
                } else {
                    openTile = link.tile2;
                }

                area5050 = [link.tile1, link.tile2];

                link.processed = true;

                let noMatch = false;
                while (openTile != null && !noMatch) {

                    noMatch = true;
                    for (let extension of links) {
                        if (!extension.processed) {

                            if (extension.tile1.x == openTile.x && extension.tile1.y == openTile.y) {
                                extensions++;
                                extension.processed = true;
                                noMatch = false;

                                // accumulate the trouble tiles as we progress;
                                link.trouble.push(...extension.trouble);
                                area5050.push(extension.tile2);   // tile2 is the new tile

                                if (extension.closed2) {
                                    if (extensions % 2 == 0 && this.noTrouble(link, area5050)) {
                                        this.writeToConsole("Tile " + functions.tileAsText(openTile) + " is an unavoidable guess, with " + extensions + " extensions");
                                        return area5050[0];
                                    } else {
                                        this.writeToConsole("Tile " + functions.tileAsText(openTile) + " is a closed extension with " + (extensions + 1) + " parts");
                                        openTile = null;
                                    }
                                } else {  // found an open extension, now look for an extension for this
                                    openTile = extension.tile2;
                                }
                                break;
                            }
                            if (extension.tile2.x == openTile.x && extension.tile2.y == openTile.y) {
                                extensions++;
                                extension.processed = true;
                                noMatch = false;

                                // accumulate the trouble tiles as we progress;
                                link.trouble.push(...extension.trouble);
                                area5050.push(extension.tile1);   // tile 1 is the new tile

                                if (extension.closed1) {
                                    if (extensions % 2 == 0 && this.noTrouble(link, area5050)) {
                                        this.writeToConsole("Tile " + functions.tileAsText(openTile) + " is an unavoidable guess, with " + extensions + " extensions");
                                        return area5050[0];
                                    } else {
                                        this.writeToConsole("Tile " + functions.tileAsText(openTile) + " is a closed extension with " + (extensions + 1) + " parts");
                                        openTile = null;
                                    }

                                } else {  // found an open extension, now look for an extension for this
                                    openTile = extension.tile1;
                                }

                                break;
                            }

                        }

                    }

                }

            }
        }

        return null;
    }

    noTrouble(link, area) {

        // each trouble location must be adjacent to 2 tiles in the extended 50/50
        top: for (let tile of link.trouble) {

            for (let tile5050 of area) {
                if (tile.x == tile5050.x && tile.y == tile5050.y) {
                    continue top;    //if a trouble tile is part of the 50/50 it isn't trouble
                }
            }


            let adjCount = 0;
            for (let tile5050 of area) {
                if (functions.isAdjacent(tile, tile5050)) {
                    adjCount++;
                }
            }
            if (adjCount % 2 != 0) {
                this.writeToConsole("Trouble Tile " + functions.tileAsText(tile) + " isn't adjacent to an even number of tiles in the extended candidate 50/50, adjacent " + adjCount + " of " + area.length);
                return false;
            }
        }

        return true;

    }

    writeToConsole(text, always) {

        if (always == null) {
            always = false;
        }

        if (this.options.verbose || always) {
            console.log(text);
        }

    }

}

class MergeSorter {

    constructor(boxes) {

        if (boxes == null) {
            this.checks = [];
            return;
        }

        this.checks = Array(boxes.length);

        for (let i = 0; i < boxes.length; i++) {
            this.checks[i] = boxes[i].uid;
        }

    }

    compare(p1, p2) {

        let c = p1.mineCount - p2.mineCount;

        if (c != 0) {
            return c;
        }

        for (let i = 0; i < this.checks.length; i++) {
            let index = this.checks[i];

            c = p1.allocatedMines[index] - p2.allocatedMines[index];

            if (c != 0) {
                return c;
            }

        }

        return 0;
    }
		
}

/*
 * Used to hold a solution
 */
class ProbabilityLine {

	constructor(boxCount, solutionCount) {
		
        this.mineCount = 0;
        if (solutionCount == null) {
            this.solutionCount = BigInt(0);
        } else {
            this.solutionCount = solutionCount;
        }
        
        this.mineBoxCount = Array(boxCount).fill(BigInt(0));
        this.allocatedMines = Array(boxCount).fill(0);

    }
	
}

// used to hold what we need to analyse next
class NextWitness {
    constructor(boxWitness) {

        this.boxWitness = boxWitness;

        this.oldBoxes = [];
        this.newBoxes = [];

        for (let i = 0; i < this.boxWitness.boxes.length; i++) {

            var box = this.boxWitness.boxes[i];
            if (box.processed) {
                this.oldBoxes.push(box);
            } else {
                this.newBoxes.push(box);
            }
        }
    }

}



// holds a witness and all the Boxes adjacent to it
class BoxWitness {
	constructor(board, tile) {

        this.tile = tile;

        this.boxes = [];  // adjacent boxes 
        this.tiles = [];  // adjacent tiles

        this.processed = false;
        this.minesToFind = tile.value;   

        for (let adjTile of functions.adjacentIterator(board.width, board.height, board.allTiles, tile)) {
            if (adjTile.mine != null) {
                this.minesToFind--;
            } else if (adjTile.value == null) {
                this.tiles.push(adjTile);
            }
        }

 	}

    overlap(boxWitness) {

        // if the locations are too far apart they can't share any of the same squares
        if (Math.abs(boxWitness.tile.x - this.tile.x) > 2 || Math.abs(boxWitness.tile.y - this.tile.y) > 2) {
            return false;
        }

        top: for (let i = 0; i < boxWitness.tiles.length; i++) {

            const tile1 = boxWitness.tiles[i];

            for (let j = 0; j < this.tiles.length; j++) {

                const tile2 = this.tiles[j];

                if (tile1.x == tile2.x && tile1.y == tile2.y) {  // if they share a tile then return true
                    return true;
                }
            }
        }

        // no shared tile found
        return false;

    }


    // if two witnesses have the same Squares around them they are equivalent
    equivalent(boxWitness) {

        // if the number of squares is different then they can't be equivalent
        if (this.tiles.length != boxWitness.tiles.length) {
            return false;
        }

        // if the locations are too far apart they can't share the same squares
        if (Math.abs(boxWitness.tile.x - this.tile.x) > 2 || Math.abs(boxWitness.tile.y - this.tile.y) > 2) {
            return false;
        }

        for (let i = 0; i < this.tiles.length; i++) {

            const l1 = this.tiles[i];

            let found = false;
            for (let j = 0; j < boxWitness.tiles.length; j++) {
                if (boxWitness.tiles[j].x == l1.x && boxWitness.tiles[j].y == l1.y) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                return false;
            }
        }

        return true;
    }

    // add an adjacdent box 
    addBox(box) {
        this.boxes.push(box);
    }
}

// a box is a group of tiles which share the same witnesses
class Box {
	constructor(boxWitnesses, tile, uid) {

        this.processed = false;

		this.uid = uid;
        this.minMines;
        this.maxMines;

        this.tiles = [tile];

        // this is used to indicate how many tiles in the box must not contain mine.
        this.emptyTiles = 0;

		this.boxWitnesses = [];

        this.safety = 0;

		for (let i=0; i < boxWitnesses.length; i++) {
			if (functions.isAdjacent(tile, boxWitnesses[i].tile)) {
                this.boxWitnesses.push(boxWitnesses[i]);
                boxWitnesses[i].addBox(this);

			}
		}
	}
	
	// if the tiles surrounding witnesses equal the boxes then it fits
	fits(tile, count) {

		// a tile can't share the same witnesses for this box if they have different numbers
		if (count != this.boxWitnesses.length) {
			return false;
		}
		
		for (let i=0; i < this.boxWitnesses.length; i++) {
            if (!functions.isAdjacent(this.boxWitnesses[i].tile, tile)) {
				return false;
			}
		}		
		
		return true;
		
	}

    /*
    * Once all the squares have been added we can do some calculations
    */
    calculate(minesLeft) {

        this.maxMines = Math.min(this.tiles.length, minesLeft);  // can't have more mines then there are tiles to put them in or mines left to discover
        this.minMines = 0;

        for (let i = 0; i < this.boxWitnesses.length; i++) {
            if (this.boxWitnesses[i].minesToFind < this.maxMines) {  // can't have more mines than the lowest constraint
                this.maxMines = this.boxWitnesses[i].minesToFind;
            }
        }		

    }


    incrementEmptyTiles() {

        this.emptyTiles++;
        if (this.maxMines > this.tiles.length - this.emptyTiles) {
            this.maxMines = this.tiles.length - this.emptyTiles;
        }
    }


	// add a new tile to the box
	add(tile) {
		this.tiles.push(tile);
	}

    contains(tile) {

        // return true if the given tile is in this box
        for (let i = 0; i < this.tiles.length; i++) {
            if (this.tiles[i].x == tile.x && this.tiles[i].y == tile.y) {
                return true;
            }
        }

        return false;

    }

}

// information about the boxes surrounding a dead candidate
class DeadCandidate {

    constructor() {

        this.candidate;
        this.myBox;
        this.isAlive = false;
        this.goodBoxes = [];
        this.badBoxes = [];

        this.firstCheck = true;
        this.total = 0;

    }

}

// Links which when joined together might form a 50/50 chain
class Link {

    constructor() {

        this.tile1;
        this.closed1 = true;
        this.tile2;
        this.closed2 = true;

        this.processed = false;

        this.trouble = [];
    }

}

/*
 *  Brute force analysis and support classes
 */


/**
 *  Performs a brute force search on the provided squares using the iterator 
 */
class Cruncher {

    static BOMB = 9;

    constructor(board, iterator) {

        this.board = board;
        this.iterator = iterator;   // the iterator
        this.tiles = iterator.tiles;  // the tiles the iterator is iterating over
        this.witnesses = iterator.probabilityEngine.dependentWitnesses;  // the dependent witnesses (class BoxWitness) which need to be checked to see if they are satisfied

        this.allSolutions = [];  // this is where the solutions needed by the Brute Force Analysis class are held

        // determine how many mines are currently next to each tile
        this.currentFlagsTiles = [];
        for (let i = 0; i < this.tiles.length; i++) {

            let adjMines = 0;
            for (let adjTile of functions.adjacentIterator(board.width, board.height, board.allTiles, this.tiles[i])) {
                if (adjTile.mine != null) {
                    adjMines++;
                }
            }

            this.currentFlagsTiles.push(adjMines);
        }

        // determine how many flags are currently next to each witness
        this.currentFlagsWitnesses = [];
        for (let i = 0; i < this.witnesses.length; i++) {

            let adjMines = 0;
            for (let adjTile of functions.adjacentIterator(board.width, board.height, board.allTiles, this.witnesses[i].tile)) {
                if (adjTile.mine != null) {
                    adjMines++;
                }
            }
            this.currentFlagsWitnesses.push(adjMines);
            //console.log("Dependent witness " + functions.tileAsText(this.witnesses[i].tile) + " already has " + adjMines + " adjacent mines");
        }

        this.duration = 0;

    }

    crunch() {

        const start = Date.now();

        let sample = this.iterator.getSample();  // first sample

        let candidates = 0;  // number of samples which satisfy the current board state

        while (sample != null) {

            if (this.checkSample(sample)) {
                candidates++;
            }

            sample = this.iterator.getSample();

        }

        this.duration = Date.now() - start;

        console.log(this.iterator.iterationsDone + " cycles took " + this.duration + " milliseconds");

        return candidates;

    }

    // this checks whether the positions of the mines are a valid candidate solution
    checkSample(sample) {

        // get the tiles which are mines in this sample
        const mine = [];
        for (let i = 0; i < sample.length; i++) {
            mine.push(this.tiles[sample[i]]);
        }

        for (let i = 0; i < this.witnesses.length; i++) {

            const flags1 = this.currentFlagsWitnesses[i];
            let flags2 = 0;

            // count how many candidate mines are next to this witness
            for (let j = 0; j < mine.length; j++) {

                if (functions.isAdjacent(mine[j], this.witnesses[i].tile)) {
                    flags2++;
                }
            }

            const value = this.witnesses[i].tile.value;  // number of flags indicated on the tile

            if (value != flags1 + flags2) {
                //console.log(flags1 + " + " + flags2 + " != " + value);
                return false;
            } else {
                //console.log(flags1 + " + " + flags2 + " == " + value);
            }
        }

        // store the good solution
        const solution = new Array(this.tiles.length);

        for (let i = 0; i < this.tiles.length; i++) {

            let isMine = false;
            for (let j = 0; j < sample.length; j++) {
                if (i == sample[j]) {
                    isMine = true;
                    break;
                }
            }

            // if we are a mine then it doesn't matter how many mines surround us
            if (!isMine) {
                var flags2 = this.currentFlagsTiles[i];
                // count how many candidate mines are next to this square
                for (let j = 0; j < mine.length; j++) {
                    if (functions.isAdjacent(mine[j], this.tiles[i])) {
                        flags2++;
                    }
                }
                solution[i] = flags2;
            } else {
                solution[i] = Cruncher.BOMB;
            }

        }

        this.allSolutions.push(solution);

        return true;

    }

}



class WitnessWebIterator {

    // create an iterator which is like a set of rotating wheels, each one ticking round when the previous one completes
    constructor(pe, allCoveredTiles, rotation) {

        this.sample = [];  // int array

        this.tiles = [];  // list of tiles being iterated over

        this.cogs = []; // array of cogs
        this.squareOffset = [];  // int array
        this.mineOffset = [];   // int array

        this.iterationsDone = 0;

        this.top;
        this.bottom;

        this.done = false;

        this.probabilityEngine = pe;

        this.cycles = BigInt(1);

        // if we are setting the position of the top cog then it can't ever change
        if (rotation == -1) {
            this.bottom = 0;
        } else {
            this.bottom = 1;
        }

        const loc = [];  // array of locations

        var indWitnesses = this.probabilityEngine.independentWitnesses;

        let indSquares = 0;
        let indMines = 0;

        // create an array of locations in the order of independent witnesses
        for (let i = 0; i < indWitnesses.length; i++) {

            const w = indWitnesses[i];

            this.squareOffset.push(indSquares);
            this.mineOffset.push(indMines);
            this.cogs.push(new SequentialIterator(w.minesToFind, w.tiles.length));

            indSquares = indSquares + w.tiles.length;
            indMines = indMines + w.minesToFind;

            loc.push(...w.tiles);

            // multiply up the number of iterations needed
            this.cycles = this.cycles * ProbabilityEngine.binomial.generate(w.minesToFind, w.tiles.length);

        }

        // the last cog has the remaining squares and mines

        //add the rest of the locations
        for (let i = 0; i < allCoveredTiles.length; i++) {

            const l = allCoveredTiles[i];

            // ignore mines
            if (l.mine != null) {
                continue;
            }

            let skip = false;
            for (let j = 0; j < loc.length; j++) {

                const m = loc[j];

                if (l.x == m.x && l.y == m.y) {
                    skip = true;
                    break;
                }
            }
            if (!skip) {
                loc.push(l);
            }
        }

        this.tiles = loc;

        /*
        console.log("Mines left " + this.probabilityEngine.minesLeft);
        console.log("Independent Mines " + indMines);
        console.log("Tiles left " + this.probabilityEngine.tilesLeft);
        console.log("Independent tiles " + indSquares);
        */

        // if there are more mines left then squares then no solution is possible
        // if there are not enough mines to satisfy the minimum we know are needed
        if (this.probabilityEngine.minesLeft - indMines > this.probabilityEngine.tilesLeft - indSquares
            || indMines > this.probabilityEngine.minesLeft) {
            this.done = true;
            this.top = 0;
            console.log("Nothing to do in this iterator");
            return;
        }

        // if there are no mines left then no need for a cog
        if (this.probabilityEngine.minesLeft > indMines) {
            this.squareOffset.push(indSquares);
            this.mineOffset.push(indMines);
            this.cogs.push(new SequentialIterator(this.probabilityEngine.minesLeft - indMines, this.probabilityEngine.tilesLeft - indSquares));

            this.cycles = this.cycles * ProbabilityEngine.binomial.generate(this.probabilityEngine.minesLeft - indMines, this.probabilityEngine.tilesLeft - indSquares);
        }

        this.top = this.cogs.length - 1;

        this.sample = new Array(this.probabilityEngine.minesLeft);  // make the sample array the size of the number of mines

        // now set up the initial sample position
        for (let i = 0; i < this.top; i++) {
            const s = this.cogs[i].getNextSample();
            for (let j = 0; j < s.length; j++) {
                this.sample[this.mineOffset[i] + j] = this.squareOffset[i] + s[j];
            }
        }

        console.log("Iterations needed " + this.cycles);

        Object.seal(this);  // prevent new values being created
    }


    getSample() {


        if (this.done) {
            console.log("**** attempting to iterator when already completed ****");
            return null;
        }
        let index = this.top;

        let s = this.cogs[index].getNextSample();

        while (s == null && index != this.bottom) {
            index--;
            s = this.cogs[index].getNextSample();
        }

        if (index == this.bottom && s == null) {
            this.done = true;
            return null;
        }

        for (let j = 0; j < s.length; j++) {
            this.sample[this.mineOffset[index] + j] = this.squareOffset[index] + s[j];
        }
        index++;
        while (index <= this.top) {
            this.cogs[index] = new SequentialIterator(this.cogs[index].numberBalls, this.cogs[index].numberHoles);
            s = this.cogs[index].getNextSample();
            for (let j = 0; j < s.length; j++) {
                this.sample[this.mineOffset[index] + j] = this.squareOffset[index] + s[j];
            }
            index++;
        }

        this.iterationsDone++;

        return this.sample;

    }

    getTiles() {
        return this.allCoveredTiles;
    }

    getIterations() {
        return this.iterationsDone;
    }

    // if the location is a Independent witness then we know it will always
    // have exactly the correct amount of mines around it since that is what
    // this iterator does
    witnessAlwaysSatisfied(location) {

        for (let i = 0; i < this.probabilityEngine.independentWitness.length; i++) {
            if (this.probabilityEngine.independentWitness[i].equals(location)) {
                return true;
            }
        }

        return false;

    }

}


class SequentialIterator {


    // a sequential iterator that puts n-balls in m-holes once in each possible way
    constructor(n, m) {

        this.numberHoles = m;
        this.numberBalls = n;

        this.sample = [];  // integer

        this.more = true;

        this.index = n - 1;

        for (let i = 0; i < n; i++) {
            this.sample.push(i);
        }

        // reduce the iterator by 1, since the first getSample() will increase it
        // by 1 again
        this.sample[this.index]--;

        //console.log("Sequential Iterator has " + this.numberBalls + " mines and " + this.numberHoles + " squares");

        Object.seal(this);  // prevent new values being created

    }

    getNextSample() {

        if (!this.more) {
            console.log("****  Trying to iterate after the end ****");
            return null;
        }

        this.index = this.numberBalls - 1;

        // add on one to the iterator
        this.sample[this.index]++;

        // if we have rolled off the end then move backwards until we can fit
        // the next iteration
        while (this.sample[this.index] >= this.numberHoles - this.numberBalls + 1 + this.index) {
            if (this.index == 0) {
                this.more = false;
                return null;
            } else {
                this.index--;
                this.sample[this.index]++;
            }
        }

        // roll forward 
        while (this.index != this.numberBalls - 1) {
            this.index++;
            this.sample[this.index] = this.sample[this.index - 1] + 1;
        }

        return this.sample;

    }

}


/**
 *  Build and navigate a game tree of all possible moves and positions to find the optimal way to play the end game
 */

class BruteForceAnalysis {

    constructor(solutions, tiles, verbose) {  // tiles is array of class 'Tile' being considered

        this.allTiles = tiles;

        this.allDead = false;   // this is true if all the locations are dead
        this.deadTiles = [];

        this.winChance = null;
        this.currentNode = null;

        this.bestTile = null;
        this.processedMoves = [];

        this.completed = false;

        this.verbose = verbose;

        // create the solutions class
        this.allSolutions = new SolutionTable(solutions, this.allTiles);

        // define a new cache
        this.cacheHelper = new BFDACache();  

        Object.seal(this);  // prevent new values being created
    }

    process() {

        const start = performance.now();

        this.writeToConsole("----- Brute Force Deep Analysis starting ----");
        this.writeToConsole(this.allSolutions.size() + " solutions in BruteForceAnalysis");

        // create the top node 
        let top = this.buildTopNode(this.allSolutions);  // top is class 'Node'

        if (top.getLivingLocations().length == 0) {
            this.allDead = true;
        }

        let best = 0;

        for (let i = 0; i < top.getLivingLocations().length; i++) {

            const move = top.getLivingLocations()[i];  // move is class 'Livinglocation'

            const winningLines = top.getWinningLinesStart(move);  // calculate the number of winning lines if this move is played

            // if the move wasn't pruned is it a better move
            if (!move.pruned) {
                if (best < winningLines || (top.bestLiving != null && best == winningLines && top.bestLiving.mineCount < move.mineCount)) {
                    best = winningLines;
                    top.bestLiving = move;
                }
            }

            const singleProb = (this.allSolutions.size() - move.mineCount) / this.allSolutions.size();

            if (move.pruned) {
                this.writeToConsole(move.index + " " + functions.tileAsText(this.allTiles[move.index]) + " is living with " + move.count + " possible values and probability "
                    + this.percentage(singleProb) + ", this location was pruned (max winning lines " + winningLines + ", process count " + this.cacheHelper.processCount + ")");
            } else {
                this.writeToConsole(move.index + " " + functions.tileAsText(this.allTiles[move.index]) + " is living with " + move.count + " possible values and probability "
                    + this.percentage(singleProb) + ", winning lines " + winningLines + " (" + "process count " + this.cacheHelper.processCount + ")");
            }

            if (this.processCount < PeConstant.BRUTE_FORCE_ANALYSIS_MAX_NODES) {
                this.processedMoves.push(this.allTiles[move.index]);  // store the tiles we've processed
            }

        }

        top.winningLines = best;

        this.currentNode = top;

        // this is the best tile to guess (or the best we've calculated if incomplete).  "Tile" class.
        if (top.bestLiving != null) {
            this.bestTile = this.allTiles[top.bestLiving.index];
        }


        if (this.cacheHelper.processCount < PeConstant.BRUTE_FORCE_ANALYSIS_MAX_NODES) {
            this.winChance = best / this.allSolutions.size();
            this.completed = true;
            if (true) {
                this.writeToConsole("--------- Probability Tree dump start ---------");
                this.showTree(0, 0, top);
                this.writeToConsole("---------- Probability Tree dump end ----------");
            }
        }

        const end = performance.now();;
        this.writeToConsole("Total nodes in cache = " + this.cacheHelper.cache.size + ", total cache hits = " + this.cacheHelper.cacheHit + ", total winning lines saved = " + this.cacheHelper.cacheWinningLines);
        this.writeToConsole("process took " + (end - start) + " milliseconds and explored " + this.cacheHelper.processCount + " nodes");
        this.writeToConsole("----- Brute Force Deep Analysis finished ----");

        // clear down the cache
        this.cacheHelper.cache.clear();

    }

    // See if we have a move better
    checkForBetterMove(guess) {

        // if we haven't processed 2 tiles or this tile is the best then stick with it
        if (this.processedMoves.length < 2 || (guess.x == this.bestTile.x && guess.y == this.bestTile.y)) {
            return null;
        }

        for (let tile of this.processedMoves) {
            if (guess.x == tile.x && guess.y == tile.y) {  // if we have processed the guess and it isn't the best tile then return the best tile
                return this.bestTile;
            }
        }

        //  otherwise nothing better
        return null;

    }

    /**
     * Builds a top of tree node based on the solutions provided
     */
    buildTopNode(solutionTable) {

        const result = new Node(null, this.allSolutions, this.cacheHelper);

        result.startLocation = 0;
        result.endLocation = solutionTable.size();

        const living = [];  // living is an array of 'LivingLocation'

        for (let i = 0; i < this.allTiles.length; i++) {
            let value;

            const valueCount = new Array(9).fill(0);
            let mines = 0;
            let maxSolutions = 0;
            let count = 0;
            let minValue = 0;
            let maxValue = 0;

            for (let j = 0; j < result.getSolutionSize(); j++) {
                if (solutionTable.get(j)[i] != Cruncher.BOMB) {
                    value = solutionTable.get(j)[i];
                    valueCount[value]++;
                } else {
                    mines++;
                }
            }

            for (let j = 0; j < valueCount.length; j++) {
                if (valueCount[j] > 0) {
                    if (count == 0) {
                        minValue = j;
                    }
                    maxValue = j;
                    count++;
                    if (maxSolutions < valueCount[j]) {
                        maxSolutions = valueCount[j];
                    }
                }
            }
            if (count > 1) {
                const alive = new LivingLocation(i, this.allSolutions, this.cacheHelper);   // alive is class 'LivingLocation'
                alive.mineCount = mines;
                alive.count = count;
                alive.minValue = minValue;
                alive.maxValue = maxValue;
                alive.maxSolutions = maxSolutions;
                alive.zeroSolutions = valueCount[0];
                living.push(alive);
            } else {
                this.writeToConsole(functions.tileAsText(this.allTiles[i]) + " is dead with value " + minValue);
                this.deadTiles.push(this.allTiles[i]);   // store the dead tiles
            }

        }

        living.sort((a, b) => a.compareTo(b));

        result.livingLocations = living;

        return result;
    }



    getNextMove() {

        const bestLiving = this.getBestLocation(this.currentNode);  /// best living is 'LivingLocation'

        if (bestLiving == null) {
            return null;
        }

        const loc = this.allTiles[bestLiving.index];  // loc is class 'Tile'

        //solver.display("first best move is " + loc.display());
        const prob = 1 - (bestLiving.mineCount / this.currentNode.getSolutionSize());

        //console.log("mines = " + bestLiving.mineCount + " solutions = " + this.currentNode.getSolutionSize());
        for (let i = 0; i < bestLiving.children.length; i++) {
            if (bestLiving.children[i] == null) {
                //solver.display("Value of " + i + " is not possible");
                continue; //ignore this node but continue the loop
            }

            let probText;
            if (bestLiving.children[i].bestLiving == null) {
                probText = 1 / bestLiving.children[i].getSolutionSize();
            } else {
                probText = bestLiving.children[i].getProbability();
            }
            //console.log("Value of " + i + " leaves " + bestLiving.children[i].getSolutionSize() + " solutions and winning probability " + probText + " (work size " + bestLiving.children[i].work + ")");
        }

        const action = new Action(loc.getX(), loc.getY(), prob, ACTION_CLEAR);

        this.expectedMove = loc;

        return action;

    }

    getBestLocation(node) {
        return node.bestLiving;
    }


    showTree(depth, value, node) {

        let condition;
        if (depth == 0) {
            condition = node.getSolutionSize() + " solutions remain";
        } else {
            condition = "When '" + value + "' ==> " + node.getSolutionSize() + " solutions remain";
        }

        if (node.bestLiving == null) {
            const line = PeConstant.INDENT.substring(0, depth * 3) + condition + " Solve chance " + node.getProbability();

            this.writeToConsole(line);
            return;
        }

        const loc = this.allTiles[node.bestLiving.index];

        const prob = 1 - (node.bestLiving.mineCount / node.getSolutionSize());


        const line = PeConstant.INDENT.substring(0, depth * 3) + condition + " play " + functions.tileAsText(loc) + " Survival chance " + prob + ", Solve chance " + node.getProbability();
        this.writeToConsole(line);

        for (let val = 0; val < node.bestLiving.children.length; val++) {
            const nextNode = node.bestLiving.children[val];
            if (nextNode != null) {
                this.showTree(depth + 1, val, nextNode);
            }
        }

    }


    getExpectedMove() {
        return this.expectedMove;
    }

    percentage(prob) {
        return prob * 100;
    }

    allTilesDead() {
        return this.allDead;
    }

    writeToConsole(text) {
        if (this.verbose) {
            console.log(text);
        }
    }

}


/**
 * A key to uniquely identify a position
 */
class Position {

    constructor(p, index, value, size) {

        this.position;
        this.hash = 0;
        this.mod = BigInt(Number.MAX_SAFE_INTEGER);


        if (p == null) {
            this.position = new Array(size).fill(15);
        } else {
            // copy and update to reflect the new position
            this.position = p.position.slice();
            //this.position.push(...p.position); 
            this.position[index] = value + 50;
        }

    }


    // copied from String hash
    hashCode() {
        let h = BigInt(this.hash);
        if (h == 0 && this.position.length > 0) {
            for (let i = 0; i < this.position.length; i++) {
                h = (BigInt(31) * h + BigInt(this.position[i])) % this.mod;
            }
            this.hash = Number(h);  // convert back to a number
        }
        return this.hash;
    }

}

/**
 * Positions on the board which can still reveal information about the game.
 */
class LivingLocation {

    constructor(index, allSolutions, cacheHelper) {
        this.index = index;

        this.pruned = false;
        this.mineCount = 0;  // number of remaining solutions which have a mine in this position
        this.maxSolutions = 0;    // the maximum number of solutions that can be remaining after clicking here
        this.zeroSolutions = 0;    // the number of solutions that have a '0' value here
        this.maxValue = -1;
        this.minValue = -1;
        this.count;  // number of possible values at this location

        this.children;  // children is an array of class 'Node'

        this.allSolutions = allSolutions;
        this.cacheHelper = cacheHelper;

    }

    /**
     * Determine the Nodes which are created if we play this move. Up to 9 positions where this locations reveals a value [0-8].
     */
    buildChildNodes(parent) {  // parent is class 'Node'

        // sort the solutions by possible values
        this.allSolutions.sortSolutions(parent.startLocation, parent.endLocation, this.index);
        let index = parent.startLocation;

        const work = Array(9);  // work is an array of class 'Node' with size 9

        for (let i = this.minValue; i < this.maxValue + 1; i++) {

            // if the node is in the cache then use it
            const pos = new Position(parent.position, this.index, i, this.allSolutions.allTiles.length);

            const temp1 = this.cacheHelper.cache.get(pos.hashCode());  // temp1 is class 'Node'

            if (temp1 == null) {

                const temp = new Node(pos, this.allSolutions, this.cacheHelper);

                temp.startLocation = index;
                // find all solutions for this values at this location
                while (index < parent.endLocation && this.allSolutions.get(index)[this.index] == i) {
                    index++;
                }
                temp.endLocation = index;

                work[i] = temp;

            } else {
                work[i] = temp1;
                this.cacheHelper.cacheHit++;
                this.cacheHelper.cacheWinningLines = this.cacheHelper.cacheWinningLines + temp1.winningLines;
                // skip past these details in the array
                while (index < parent.endLocation && this.allSolutions.get(index)[this.index] <= i) {
                    index++;
                }
            }
        }

        // skip over the mines
        while (index < parent.endLocation && this.allSolutions.get(index)[this.index] == Cruncher.BOMB) {
            index++;
        }

        if (index != parent.endLocation) {
            console.log("**** Didn't read all the elements in the array; index = " + index + " end = " + parent.endLocation + " ****");
        }


        for (let i = this.minValue; i <= this.maxValue; i++) {
            if (work[i].getSolutionSize() > 0) {
                //if (!work[i].fromCache) {
                //	work[i].determineLivingLocations(this.livingLocations, living.index);
                //}
            } else {
                work[i] = null;   // if no solutions then don't hold on to the details
            }

        }

        this.children = work;

    }


    compareTo(o) {

        // return location most likely to be clear  - this has to be first, the logic depends upon it
        let test = this.mineCount - o.mineCount;
        if (test != 0) {
            return test;
        }

        // then the location most likely to have a zero
        test = o.zeroSolutions - this.zeroSolutions;
        if (test != 0) {
            return test;
        }

        // then by most number of different possible values
        test = o.count - this.count;
        if (test != 0) {
            return test;
        }

        // then by the maxSolutions - ascending
        return this.maxSolutions - o.maxSolutions;

    }

}

/**
 * A representation of a possible state of the game
 */
class Node {

    constructor(position, allSolutions, cacheHelper) {

        this.allSolutions = allSolutions;
        this.cacheHelper = cacheHelper;

        this.position;   // representation of the position we are analysing / have reached

        if (position == null) {
            this.position = new Position(null, 0, 0, this.allSolutions.allTiles.length);  // a new blank position
        } else {
            this.position = position;
        }

        this.livingLocations;       // these are the locations which need to be analysed

        this.winningLines = 0;      // this is the number of winning lines below this position in the tree
        this.work = 0;              // this is a measure of how much work was needed to calculate WinningLines value
        this.fromCache = false;     // indicates whether this position came from the cache

        this.startLocation;         // the first solution in the solution array that applies to this position
        this.endLocation;           // the last + 1 solution in the solution array that applies to this position

        this.bestLiving;            // after analysis this is the location that represents best play

    }

    getLivingLocations() {
        return this.livingLocations;
    }

    getSolutionSize() {
        return this.endLocation - this.startLocation;
    }

    /**
     * Get the probability of winning the game from the position this node represents  (winningLines / solution size)
      */
    getProbability() {

        return this.winningLines / this.getSolutionSize();

    }

    /**
     * Calculate the number of winning lines if this move is played at this position
     * Used at top of the game tree
     */
    getWinningLinesStart(move) {  // move is class LivingLocation 

        //if we can never exceed the cutoff then no point continuing
        if (PeConstant.PRUNE_BF_ANALYSIS && (this.getSolutionSize() - move.mineCount <= this.winningLines)) {
            move.pruned = true;
            return this.getSolutionSize() - move.mineCount;
        }

        var winningLines = this.getWinningLines(1, move, this.winningLines);

        if (winningLines > this.winningLines) {
            this.winningLines = winningLines;
        }

        return winningLines;
    }


    /**
     * Calculate the number of winning lines if this move is played at this position
     * Used when exploring the game tree
     */
    getWinningLines(depth, move, cutoff) {  // move is class 'LivingLocation' 

        //console.log("At depth " + depth + " cutoff=" + cutoff);

        let result = 0;

        this.cacheHelper.processCount++;
        if (this.cacheHelper.processCount > PeConstant.BRUTE_FORCE_ANALYSIS_MAX_NODES) {
            return 0;
        }

        let notMines = this.getSolutionSize() - move.mineCount;   // number of solutions (at this node) which don't have a mine at this location 

        // if the max possible winning lines is less than the current cutoff then no point doing the analysis
        if (PeConstant.PRUNE_BF_ANALYSIS && (result + notMines <= cutoff)) {
            move.pruned = true;
            return result + notMines;
        }

        move.buildChildNodes(this);

        for (let i = 0; i < move.children.length; i++) {

            const child = move.children[i];  // child is class 'Node'

            if (child == null) {
                continue;  // continue the loop but ignore this entry
            }

            if (child.fromCache) {  // nothing more to do, since we did it before
                this.work++;
            } else {

                child.determineLivingLocations(this.livingLocations, move.index);
                this.work++;

                if (child.getLivingLocations().length == 0) {  // no further information ==> all solution indistinguishable ==> 1 winning line

                    child.winningLines = 1;

                } else {  // not cached and not terminal node, so we need to do the recursion

                    for (let j = 0; j < child.getLivingLocations().length; j++) {

                        const childMove = child.getLivingLocations()[j];  // childmove is class 'LivingLocation'

                        // if the number of safe solutions <= the best winning lines then we can't do any better, so skip the rest
                        if (child.getSolutionSize() - childMove.mineCount <= child.winningLines) {
                            break;
                        }

                        // now calculate the winning lines for each of these children
                        const winningLines = child.getWinningLines(depth + 1, childMove, child.winningLines);
                        if (!childMove.pruned) {
                            if (child.winningLines < winningLines || (child.bestLiving != null && child.winningLines == winningLines && child.bestLiving.mineCount < childMove.mineCount)) {
                                child.winningLines = winningLines;
                                child.bestLiving = childMove;
                            }
                        }

                        // if there are no mines then this is a 100% safe move, so skip any further analysis since it can't be any better
                        if (childMove.mineCount == 0) {
                            break;
                        }


                    }

                    // no need to hold onto the living location once we have determined the best of them
                    child.livingLocations = null;

                    //add the child to the cache if it didn't come from there and it is carrying sufficient winning lines
                    if (child.work > 10) {
                        //console.log("Entry placed in cache with key " + child.position.hashCode());
                        child.work = 0;
                        child.fromCache = true;
                        this.cacheHelper.cache.set(child.position.hashCode(), child);
                    } else {
                        this.work = this.work + child.work;
                    }


                }

            }

            if (depth > PeConstant.BRUTE_FORCE_ANALYSIS_TREE_DEPTH) {  // stop holding the tree beyond this depth
                child.bestLiving = null;
            }

            // store the aggregate winning lines 
            result = result + child.winningLines;

            notMines = notMines - child.getSolutionSize();  // reduce the number of not mines

            // if the max possible winning lines is less than the current cutoff then no point doing the analysis
            if (PeConstant.PRUNE_BF_ANALYSIS && (result + notMines <= cutoff)) {
                move.pruned = true;
                return result + notMines;
            }

        }

        return result;

    }

    /**
     * this generates a list of Location that are still alive, (i.e. have more than one possible value) from a list of previously living locations
     * Index is the move which has just been played (in terms of the off-set to the position[] array)
     */
    determineLivingLocations(liveLocs, index) {  // liveLocs is a array of class 'LivingLocation' 

        const living = [];

        for (let i = 0; i < liveLocs.length; i++) {

            const live = liveLocs[i];

            if (live.index == index) {  // if this is the same move we just played then no need to analyse it - definitely now non-living.
                continue;
            }

            let value;

            const valueCount = Array(9).fill(0);
            let mines = 0;
            let maxSolutions = 0;
            let count = 0;
            let minValue = 0;
            let maxValue = 0;

            for (let j = this.startLocation; j < this.endLocation; j++) {
                value = this.allSolutions.get(j)[live.index];
                if (value != Cruncher.BOMB) {
                    valueCount[value]++;
                } else {
                    mines++;
                }
            }

            // find the new minimum value and maximum value for this location (can't be wider than the previous min and max)
            for (let j = live.minValue; j <= live.maxValue; j++) {
                if (valueCount[j] > 0) {
                    if (count == 0) {
                        minValue = j;
                    }
                    maxValue = j;
                    count++;
                    if (maxSolutions < valueCount[j]) {
                        maxSolutions = valueCount[j];
                    }
                }
            }
            if (count > 1) {
                const alive = new LivingLocation(live.index, this.allSolutions, this.cacheHelper);  // alive is class 'LivingLocation'
                alive.mineCount = mines;
                alive.count = count;
                alive.minValue = minValue;
                alive.maxValue = maxValue;
                alive.maxSolutions = maxSolutions;
                alive.zeroSolutions = valueCount[0];
                living.push(alive);
            }

        }

        living.sort((a, b) => a.compareTo(b));

        this.livingLocations = living;

    }

}

// a cache to hold positions we've navigated
class BFDACache {

    constructor() {
        this.cache = new Map();
        this.cacheHit = 0;
        this.cacheWinningLines = 0;
        this.processCount = 0;
    }
}

// used to hold all the solutions left in the game
class SolutionTable {

    constructor(solutions, allTiles) {
        this.solutions = solutions;
        this.allTiles = allTiles;
    }

    get(index) {
        return this.solutions[index];
    }

    size() {
        return this.solutions.length;
    }

    sortSolutions(start, end, index) {

        const section = this.solutions.slice(start, end);
        section.sort((a, b) => a[index] - b[index]);
        this.solutions.splice(start, section.length, ...section);
    }

}
