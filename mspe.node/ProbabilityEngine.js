/**
 * This file contains
 *    -  The entry point: function calculate(message)
 *    -  
 */

"use strict";

module.exports = {
    calculate: function (message) {
        return calculate(message);
    }
}

class PeConstant {

    // used to get adjacent tiles
    static adj = [[-1, -1], [0, -1], [1, -1], [-1, 0], [+1, 0], [-1, +1], [0, +1], [+1, +1]];

    // used to easily get small binomial coefficients
    static SMALL_COMBINATIONS = [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1], [1, 4, 6, 4, 1], [1, 5, 10, 10, 5, 1], [1, 6, 15, 20, 15, 6, 1], [1, 7, 21, 35, 35, 21, 7, 1], [1, 8, 28, 56, 70, 56, 28, 8, 1]];

    // used to divide to BigInts together and return a normal number to 6 decimal places
    static power10n = [BigInt(1), BigInt(10), BigInt(100), BigInt(1000), BigInt(10000), BigInt(100000), BigInt(1000000), BigInt(10000000)];
    static power10 = [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000];

}

class PeFunction {

    static isAdjacent(tile1, tile2) {

        let dx = Math.abs(tile1.x - tile2.x);
        let dy = Math.abs(tile1.y - tile2.y);

        // adjacent and not equal
        if (dx < 2 && dy < 2 && !(dx == 0 && dy == 0)) {
            return true;
        } else {
            return false;
        }
    }

    /**
     *   Divide some big integers back down to normal numbers 
     * */
    static divideBigInt(numerator, denominator, dp) {

        let work = numerator * PeConstant.power10n[dp] / denominator;

        let result = Number(work) / PeConstant.power10[dp];

        return result;
    }


}

// interprets the data we have received
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
//  This will look for trivially located mines and then call the probability engine to calculate hidden tiles safety.
//  Confirmed mines have a safety of 0 (zero).  This allows flagged tiles to be verified as being correct.

function calculate(message) {

    const reply = {};
    const start = Date.now();

    // wrap everything in a try/catch so the caller doesn't have to take responsibility
    try {

        // get board dimensions
        const width = message.board.width;
        const height = message.board.height;
        const mines = message.board.mines;


 
        console.log("Game with dimensions " + width + "x" + height + "/" + mines + " received");

        // we'll need how many mines left to find and how many tiles still covered
        let coveredCount = 0;
        let minesToFind = mines;

        // store the tiles in an array
        let allTiles = Array(width * height);

        for (let tile of message.tiles) {
            let index = tile.x + tile.y * width;
            allTiles[index] = tile;
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

        // all the tiles which are still covered, these are the ones we'll be returning
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
            for (let j of PeConstant.adj) {
                const x = tile.x + j[0];
                const y = tile.y + j[1];

                if (x < 0 || x >= width || y < 0 || y >= height) {
                    continue;
                }

                const index = x + y * width;

                const adjTile = allTiles[index];
                if (adjTile.value == null) {
                    adjCovered++;
                }
            }

            // if the number of mines to find is the same as the number of covered tiles left adjacent then mark them as mines
            if (allTiles[i].value == adjCovered) {
                for (let j of PeConstant.adj) {

                    const x = tile.x + j[0];
                    const y = tile.y + j[1];

                    if (x < 0 || x >= width || y < 0 || y >= height) {
                        continue;
                    }

                    const index = x + y * width;

                    const adjTile = allTiles[index];
                    if (adjTile.value == null && adjTile.mine == null) {
                        minesToFind--;
                        coveredCount--;
                        adjTile.mine = true;
                        adjTile.safety = 0;
                    }
                }
            } else {
                witnesses.push(tile);  // if uncovered and not satisifed still work to do
            }
        }

         // get all the tiles adjacent to unsatisfied witnesses
        const work = new Set();  // use a set to deduplicate the witnessed tiles
        for (let tile of witnesses) {

            for (let j of PeConstant.adj) {
                const x = tile.x + j[0];
                const y = tile.y + j[1];

                if (x < 0 || x >= width || y < 0 || y >= height) {
                    continue;
                }

                const index = x + y * width;

                const adjTile = allTiles[index];
                if (adjTile.value == null && adjTile.mine == null) {   // not a mine and covered
                    work.add(index);
                }

            }
        }

        const witnessed = [];
        for (let index of work) {
            witnessed.push(allTiles[index]);
         }

        let offEdgeSafety;
 
        // if there are no witnesses then the safety is "mines to find" / "covered tiles"  
        if (witnesses.length == 0) {

            if (coveredCount != 0) {
                offEdgeSafety = (1 - (minesToFind / coveredCount)).toFixed(6);
            } else {
                offEdgeSafety = 0;
            }

        } else {  // use the probability engine

            // the board details
            const board = {};
            board.width = width;
            board.height = height;
            board.allTiles = allTiles;

            // options 
            const options = {};
            options.verbose = true;

            // send all this information into the probability engine
            var pe = new ProbabilityEngine(board, witnesses, witnessed, coveredCount, minesToFind, options);

            if (pe.validWeb) {
                pe.process();

                if (pe.finalSolutionsCount == 0) {
                    throw new Error("Position is not logically consistent");
                } else {
                    offEdgeSafety = pe.offEdgeProbability.toFixed(6);
                }
            } else {
                throw new Error("Position is not logically consistent");
            }

        }

        // set up the reply
        reply.valid = true;
        reply.board = message.board;

        // tiles without a calculated safety must be off the edge, so set to the off edge safety
        for (let tile of coveredTiles) {
            if (tile.safety == null) {
                tile.safety = offEdgeSafety;
            }
            if (tile.mine) {  // don't want to send this back so delete it
                delete tile.mine;
            }
        }

        // sort the tiles into safest first order
        coveredTiles.sort(function (a, b) { return b.safety - a.safety });

        reply.tiles = coveredTiles;
 
    } catch (e) {
        console.log(e.name + ": " + e.message);
        console.trace();  // dump the trace

        // return a error response
        reply.valid = false;
        reply.message = e.name + ": " + e.message;
        reply.tiles = [];
    }

    console.log("Duration: " + (Date.now() - start) + " milliseconds");

    return reply;
}


/**
 *  Binomial Coefficient calculator 
 *  Uses a fast algorithm for large coefficients
 *  Pre-calculates some binomial coefficients for speed
 **/

class Binomial {

    constructor(max, lookup) {

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




class ProbabilityEngine {

    static binomial = new Binomial(50000, 500);  // pre calculate some binomial coefficients

	constructor(board, allWitnesses, allWitnessed, squaresLeft, minesLeft, options) {

        this.board = board;
        this.options = options;

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

        //this.boxProb = [];  // the probabilities end up here
		this.workingProbs = []; 
        this.heldProbs = [];
        this.bestProbability = 0;  // best probability of being safe
        this.offEdgeProbability = 0;
        this.bestOnEdgeProbability;
        this.finalSolutionsCount = BigInt(0);

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
                    //if (boardState.getWitnessValue(w) - boardState.countAdjacentConfirmedFlags(w) != boardState.getWitnessValue(wit) - boardState.countAdjacentConfirmedFlags(wit)) {
                    //    boardState.display(w.display() + " and " + wit.display() + " share unrevealed squares but have different mine totals!");
                    //    validWeb = false;
                    //}
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
                if (PeFunction.isAdjacent(tile, allWitnesses[j])) {
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
            this.clearCount = 0;
            return;
        }

        const peStart = Date.now();

        // create an array showing which boxes have been procesed this iteration - none have to start with
        this.mask = Array(this.boxes.length).fill(false);

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

        this.calculateBoxProbabilities();

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
        if (this.recursions % 100 == 0) {
            console.log("Probability Engine recursision = " + recursions);
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

        //var crunched = this.workingProbs;

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

    /*
    // get the box containing this tile
    getBox(tile) {

        for (var i = 0; i < this.boxes.length; i++) {
            if (this.boxes[i].contains(tile)) {
                return this.boxes[i];
            }
        }

        this.writeToConsole("ERROR - tile " + tile.asText() + " doesn't belong to a box");

        return null;
    }
    */

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

                } else {  // neither mine nor safe
                     box.safety = (1 - PeFunction.divideBigInt(tally[i], totalTally, 6)).toFixed(6);
                }

            } else {
                this.boxProb[i] = 0;
                box.safety = 0;
            }

            for (let tile of box.tiles) {
                tile.safety = box.safety;
                this.answer.push(tile);
            }

        }

         // avoid divide by zero
        if (this.TilesOffEdge != 0 && totalTally != BigInt(0)) {
            this.offEdgeProbability = 1 - PeFunction.divideBigInt(outsideTally, totalTally * BigInt(this.TilesOffEdge), 6);
        } else {
            this.offEdgeProbability = 0;
        }

        this.finalSolutionsCount = totalTally;

        // see if we can find a guess which is better than outside the boxes
        let hwm = 0;

        for (let i = 0; i < this.boxes.length; i++) {

            const b = this.boxes[i];
             if (hwm < b.safety) {
                hwm = b.safety;
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

    /*
    getBestCandidates(freshhold) {

        var best = [];

        var test;

        if (this.bestProbability == 1) {  // if we have a probability of one then don't allow lesser probs to get a look in
            test = this.bestProbability;
        } else {
            test = this.bestProbability * freshhold;
        }

        this.writeToConsole("Best probability is " + this.bestProbability + " freshhold is " + test);

        for (var i = 0; i < this.boxProb.length; i++) {
            if (this.boxProb[i] >= test) {
                for (var j = 0; j < this.boxes[i].tiles.length; j++) {
                    var squ = this.boxes[i].tiles[j];

                    //best.push(new Action(squ.x, squ.y, this.boxProb[i]));

                    //  exclude dead tiles 
                    var dead = false;
                    for (var k = 0; k < this.deadTiles.length; k++) {
                        if (this.deadTiles[k].isEqual(squ)) {
                            dead = true;
                            break;
                        }
                    }
                    if (!dead || this.boxProb[i] == 1) {   // if not dead or 100% safe then use the tile
                        best.push(new Action(squ.x, squ.y, this.boxProb[i], ACTION_CLEAR));
                    } else {
                        this.writeToConsole("Tile " + squ.asText() + " is ignored because it is dead");
                    }
 
                }
            }
        }

        // sort in to best order
        best.sort(function (a, b) { return b.prob - a.prob });

        return best;

    }
    */

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

        for (let j of PeConstant.adj) {
            const x = tile.x + j[0];
            const y = tile.y + j[1];

            if (x < 0 || x >= board.width || y < 0 || y >= board.height) {
                continue;
            }

            const index = x + y * board.width;

            const adjTile = board.allTiles[index];
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

		this.boxWitnesses = [];

        this.safety = 0;

		for (let i=0; i < boxWitnesses.length; i++) {
			if (PeFunction.isAdjacent(tile, boxWitnesses[i].tile)) {
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
            if (!PeFunction.isAdjacent(this.boxWitnesses[i].tile, tile)) {
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
