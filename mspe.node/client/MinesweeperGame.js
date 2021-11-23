/**
 *   This module defines a game of minesweeper
 *   
 */

"use strict";

const ACTION_CLEAR = 1;
const ACTION_FLAG = 2;
const ACTION_CHORD = 3;

const WON = "won";
const LOST = "lost";
const IN_PLAY = "in-play";

/**
 * This describes a game of minesweeper
 */
class ServerGame {
	
	constructor(id, width, height, num_bombs, index, seed, gameType) {
		
		//console.log("Creating a new game with id=" + id + " ...");

        this.created = new Date();
        this.lastAction = this.created;

        this.id = id;
        this.gameType = gameType;
		this.width = width;
		this.height = height;
        this.num_bombs = num_bombs;
        this.seed = seed;
		this.cleanUp = false;
		this.actions = 0;
		this.cleared3BV = 0;
		this.startIndex = index;

        //console.log("Using seed " + this.seed);

		this.tiles = [];
		this.started = false;

		this.tilesLeft = this.width * this.height - this.num_bombs;
		
		// create adjacent offsets
		this.adj_offset = [];
		this.adj_offset[0] =  - width - 1;
		this.adj_offset[1] =  - width;
		this.adj_offset[2] =  - width + 1;
		this.adj_offset[3] =  - 1;
		this.adj_offset[4] =  1;
		this.adj_offset[5] =  + width - 1;
		this.adj_offset[6] =  + width;
		this.adj_offset[7] =  + width + 1;
		
		// hold the tiles to exclude from being a mine 
		const exclude = {};
		exclude[index] = true;
		var excludeCount = 1;

		if (this.gameType == "zero") {
            for (let adjIndex of this.getAdjacentIndex(index)) {
				exclude[adjIndex] = true;
				excludeCount++;
            }
        }

		if (this.width * this.height - excludeCount < this.num_bombs) {
			this.num_bombs = this.width * this.height - excludeCount;
			console.log("WARN: Too many mines to be placed! Reducing mine count to " + this.num_bombs);
        }

		this.init_tiles(exclude);

		this.value3BV = this.calculate3BV();

		//console.log("... game created");

	}

	reset() {

		this.cleanUp = false;
		this.actions = 0;
		this.cleared3BV = 0;
		this.started = false;
		this.tilesLeft = this.width * this.height - this.num_bombs;

		for (let i = 0; i < this.tiles.length; i++) {
			const tile = this.tiles[i];
			tile.reset();
		}

		// this is used by the NG processing and because mines have been moved
		// the 3BV needs to be recalculated
		this.value3BV = this.calculate3BV();

    }

	resetMines(blob) {

		// reset every tile and it isn't a bomb
		for (let i = 0; i < this.tiles.length; i++) {
			const tile = this.tiles[i];
			tile.reset();
			tile.is_bomb = false;
			tile.value = 0;
		}

		let index = 4;

		// set the tiles in the mbf to mines
		while (index < blob.length) {
			const i = blob[index + 1] * this.width + blob[index];

			const tile = this.tiles[i];

			tile.make_bomb();
			for (let adjTile of this.getAdjacent(tile)) {
				adjTile.value += 1;
			}

			index = index + 2;
        }

		this.value3BV = this.calculate3BV();
		this.url = this.getFormatMBF();

    }

	getID() {
		return this.id;
	}
	
	getTile(index) {
		return this.tiles[index];
	}

	// toggles the flag on a tile
	flag(tile) {

		this.actions++;
		tile.toggleFlag();

    }

	// clicks the assigned tile and returns an object containing a list of tiles cleared
	clickTile(tile) {
		
        const reply = { "header": {}, "tiles": [] };

        // are we clicking on a mine
		if (tile.isBomb()) {
			this.actions++;

            reply.header.status = LOST;
            tile.exploded = true;
			//reply.tiles.push({"action" : 3, "index" : tile.getIndex()});    // mine

        } else {
			if (tile.isCovered() && !tile.isFlagged()) {    // make sure the tile is clickable
				this.actions++;

				const tilesToReveal = [];
				tilesToReveal.push(tile);
				return this.reveal(tilesToReveal);
			} else {
				reply.header.status = IN_PLAY;
            }
		}
		
		return reply;
		
		
	}
	
	// clicks the tiles adjacent to the assigned tile and returns an object containing a list of tiles cleared
	chordTile(tile) {
		
        const reply = { "header": {}, "tiles": [] };
 		
		let flagCount = 0;
		for (let adjTile of this.getAdjacent(tile)) {
			if (adjTile.isFlagged()) {
				flagCount++;
			}
		}

		// nothing to do if the tile is not yet surrounded by the correct number of flags
		if (tile.getValue() != flagCount) {
			console.log("Unable to Chord:  value=" + tile.getValue() + " flags=" + flagCount);
			reply.header.status = IN_PLAY;
			return reply;
		}
		
		// see if there are any unflagged bombs in the area to be chorded - this loses the game
		let bombCount = 0;
		for (let adjTile of this.getAdjacent(tile)) {
            if (adjTile.isBomb() && !adjTile.isFlagged()) {
                adjTile.exploded = true;
				bombCount++;
				//reply.tiles.push({"action" : 3, "index" : adjTile.getIndex()});    // mine
			}
		}
		
		// if we have triggered a bomb then return
		if (bombCount != 0) {
			this.actions++;

			reply.header.status = LOST;
			return reply;
		}
		
		const tilesToReveal = [];

		this.actions++;

		// determine which tiles need revealing 
		for (var adjTile of this.getAdjacent(tile)) {
			if (adjTile.isCovered() && !adjTile.isFlagged()) {  // covered and not flagged
				tilesToReveal.push(adjTile);
			}
		}

		return this.reveal(tilesToReveal);
		
	}
	
	reveal(firstTiles) {
		
		const toReveal = [];
		let soFar = 0;
		
        const reply = { "header": {}, "tiles": [] };
		
		for (let firstTile of firstTiles) {
			firstTile.setNotCovered();
			if (firstTile.is3BV) {
				this.cleared3BV++;
            }
			toReveal.push(firstTile);			
		}
		
		let safety = 100000;
		
		while (soFar < toReveal.length) {
			
			const tile = toReveal[soFar];

			reply.tiles.push({"action" : 1, "index" : tile.getIndex(), "value" : tile.getValue()});   		
			this.tilesLeft--;
			
			// if the value is zero then for each adjacent tile not yet revealed add it to the list
			if (tile.getValue() == 0) {
				
				for (let adjTile of this.getAdjacent(tile)) {
					
					if (adjTile.isCovered() && !adjTile.isFlagged()) {  // if not covered and not a flag
						adjTile.setNotCovered();  // it will be uncovered in a bit
						if (adjTile.is3BV) {
							this.cleared3BV++;
						}
						toReveal.push(adjTile);
					}
				}
				
			}

			soFar++;
			if (safety-- < 0) {
				console.log("Safety limit reached !!");
				break;
			}
			
		}

        // if there are no tiles left to find then set the remaining tiles to flagged and we've won
		if (this.tilesLeft == 0) {
			for (let i=0; i < this.tiles.length; i++) {
				const tile = this.tiles[i];
				if (tile.isBomb() && !tile.isFlagged()) {
					tile.toggleFlag();
					reply.tiles.push({"action" : 2, "index" : i, "flag" : tile.isFlagged()});    // auto set remaining flags
				}
			}
			
			reply.header.status = WON;
		} else {
			reply.header.status = IN_PLAY;
		}
		
		
		return reply;
	}

	// fix modify the mines around this withness to make it a safe move
	fix(filler) {

		const reply = { "header": {}, "tiles": [] };
		reply.header.status = IN_PLAY;

		const tile = this.getTile(filler.index);


		if (filler.fill) {

			if (!tile.is_bomb) {  // if filling and not a bomb add a bomb
				tile.make_bomb();
				this.num_bombs++;
				for (let adjTile1 of this.getAdjacent(tile)) {
					adjTile1.value += 1;
					if (!adjTile1.isCovered()) {
						reply.tiles.push({ "action": 1, "index": adjTile1.getIndex(), "value": adjTile1.getValue() });
					}
				}
			}

		} else {

			if (tile.is_bomb) {  // if emptying and is a bomb - remove it
				tile.is_bomb = false;
				this.num_bombs--;
				for (let adjTile1 of this.getAdjacent(tile)) {
					adjTile1.value -= 1;
					if (!adjTile1.isCovered()) {
						reply.tiles.push({ "action": 1, "index": adjTile1.getIndex(), "value": adjTile1.getValue() });
					}
				}
			}

        }

		//console.log(reply);

		return reply;
    }


	// auto play chords
	checkAuto(tile, reply) {

		return false;

		let flagCount = 0;
		let covered = 0;
		for (var adjTile of this.getAdjacent(tile)) {
			if (adjTile.isFlagged()) {
				flagCount++;
			} else if (adjTile.isCovered()) {
				covered++;
            }
		}

		// can be chorded
		if (tile.getValue() == flagCount) {
			return true;
		}

		// all covered tiles are flags
		if (tile.getValue() == flagCount + covered) {
			for (let adjTile of this.getAdjacent(tile)) {
				if (adjTile.isFlagged()) {
				} else if (adjTile.isCovered()) {
					this.flag(adjTile);
					reply.tiles.push({ "action": 2, "index": adjTile.getIndex(), "flag": adjTile.isFlagged() });
				}
			}
        }


    }

	// builds all the tiles and assigns bombs to them
	init_tiles(to_exclude) {
		
		// create the tiles
		const indices = [];
		for (let i = 0; i < this.width * this.height; i++) {
			
			this.tiles.push(new ServerTile(i));
			
			if (!to_exclude[i]) {
				indices.push(i);
			}
        }

        const rng = JSF(this.seed);  // create an RNG based on the seed

		shuffle(indices,rng);
		
		// allocate the bombs and calculate the values
		for (let i = 0; i < this.num_bombs; i++) {
			const index = indices[i];
			const tile = this.tiles[index];
			
			tile.make_bomb();
			for (let adjTile of this.getAdjacent(tile)) {
				adjTile.value += 1;
			}
		}
		
		//console.log(this.tiles.length + " tiles added to board");
	}
	
	
	// returns all the tiles adjacent to this tile
	getAdjacent(tile) {
		
		const index = tile.getIndex();
		
		const col = index % this.width;
		const row = Math.floor(index / this.width);

		const first_row = Math.max(0, row - 1);
		const last_row = Math.min(this.height - 1, row + 1);

		const first_col = Math.max(0, col - 1);
		const last_col = Math.min(this.width - 1, col + 1);

		const result = []

		for (let r = first_row; r <= last_row; r++) {
			for (let c = first_col; c <= last_col; c++) {
				const i = this.width * r + c;
				if (i != index) {
					result.push(this.tiles[i]);
				}
			}
		}

		return result;
	}

    // returns all the tiles adjacent to this tile
    getAdjacentIndex(index) {

        const col = index % this.width;
        const row = Math.floor(index / this.width);

        const first_row = Math.max(0, row - 1);
        const last_row = Math.min(this.height - 1, row + 1);

        const first_col = Math.max(0, col - 1);
        const last_col = Math.min(this.width - 1, col + 1);

        const result = []

        for (let r = first_row; r <= last_row; r++) {
            for (let c = first_col; c <= last_col; c++) {
                const i = this.width * r + c;
                if (i != index) {
                    result.push(i);
                }
            }
        }

        return result;
    }

	calculate3BV() {

		let value3BV = 0;

		for (let i = 0; i < this.tiles.length; i++) {
			const tile = this.tiles[i];

			if (!tile.used3BV && !tile.isBomb() && tile.getValue() == 0) {

				value3BV++;
				tile.used3BV = true;
				tile.is3BV = true;

				const toReveal = [tile];
				let soFar = 0;

				let safety = 100000;

				while (soFar < toReveal.length) {

					const tile1 = toReveal[soFar];

					// if the value is zero then for each adjacent tile not yet revealed add it to the list
					if (tile1.getValue() == 0) {

						for (let adjTile of this.getAdjacent(tile1)) {

							if (!adjTile.used3BV) {

								adjTile.used3BV = true;

								if (!adjTile.isBomb() && adjTile.getValue() == 0) {  // if also a zero add to ties to be exploded
									toReveal.push(adjTile);
								}
                            }
						}
					}

					soFar++;
					if (safety-- < 0) {
						console.log("Safety limit reached !!");
						break;
					}
				}
            }
		}

		for (let i = 0; i < this.tiles.length; i++) {
			const tile = this.tiles[i];
			if (!tile.isBomb() && !tile.used3BV) {
				value3BV++;
				tile.is3BV = true;
            }

		}

		//console.log("3BV is " + value3BV);

		return value3BV;
	}

	generateMbfUrl() {

		// revoke the previous url
		if (this.url != null) {
			window.URL.revokeObjectURL(this.url);
		}

		this.url = this.getFormatMBF();
    }

	getFormatMBF() {

		if (this.width > 255 || this.height > 255) {
			console.log("Board to large to save as MBF format");
			return null;
		}

		const length = 4 + 2 * this.num_bombs;

		const mbf = new ArrayBuffer(length);
		const mbfView = new Uint8Array(mbf);

		mbfView[0] = this.width;
		mbfView[1] = this.height;

		mbfView[2] = Math.floor(this.num_bombs / 256);
		mbfView[3] = this.num_bombs % 256;

		let minesFound = 0;
		let index = 4;
		for (let i = 0; i < this.tiles.length; i++) {

			const tile = this.getTile(i);
			const x = i % this.width;
			const y = Math.floor(i / this.width);

			if (tile.isBomb()) {
				minesFound++;
				if (index < length) {
					mbfView[index++] = x;
					mbfView[index++] = y;
				}
			}
		}

		if (minesFound != this.num_bombs) {
			console.log("Board has incorrect number of mines. board=" + this.num_bombs + ", found=" + minesFound);
			return null;
		}

		console.log(...mbfView);

		const blob = new Blob([mbf], { type: 'application/octet-stream' })

		const url = URL.createObjectURL(blob);

		console.log(url);

		return url;

	}

	
	//getGameDescription() {
	//	return new gameDescription(this.seed, this.gameType, this.width, this.height, this.mines, this.startIndex, this.actions);
    //}

} 

/**
 * Describes a single tile on a minesweeper board
 */

class ServerTile {
	constructor(index) {
		this.index = index
		this.is_covered = true;
		this.value = 0;
        this.is_flagged = false;
        this.exploded = false;
		this.is_bomb = false;
		this.used3BV = false;
		this.is3BV = false;
	}

	reset() {
		this.is_covered = true;
		this.is_flagged = false;
		this.exploded = false;
		this.used3BV = false;
		this.is3BV = false;
	}

	getIndex() {
		return this.index;
	}
	
	isCovered() {
		return this.is_covered;
	}
	
	setNotCovered() {
		this.is_covered = false;
	}
	
	getValue() {
		return this.value;
	}
	
	// toggle the flag value
	toggleFlag() {
		
		// if the tile is uncovered then we can't put a flag here
		if (!this.is_covered) {
			this.is_flagged = false;
			return;
		}
		
		this.is_flagged = !this.is_flagged;
	}
	
	isFlagged() {
		return this.is_flagged;
	}

	make_bomb() {
		this.is_bomb = true;
	}
	
	isBomb() {
		return this.is_bomb;
	}

}

/*
class gameDescription {

	constructor(seed, gameType, width, height, mines, index, actions) {

		console.log("Creating a new game state with");

		this.seed = seed;
		this.gameType = gameType;
		this.width = width;
		this.height = height;
		this.mines = mines;
		this.index = index;
		this.actions = actions;
	}

}
*/

// used to shuffle an array
function shuffle(a, rng) {
 
    for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		//console.log(j);
        //j = Math.floor(Math.random() * (i + 1));
        const x = a[i];
        a[i] = a[j];
        a[j] = x;
    }
    return a;
}

// a RNG which allows a seed
function JSF(seed) {
    function jsf() {
        var e = s[0] - (s[1] << 27 | s[1] >>> 5);
        s[0] = s[1] ^ (s[2] << 17 | s[2] >>> 15),
            s[1] = s[2] + s[3],
			s[2] = s[3] + e, s[3] = s[0] + e;
		//console.log(e + " " + s[0] + " " + s[1] + " " + s[2] + " " + s[3]);
        return (s[3] >>> 0) / 4294967296; // 2^32
	}
	var seed1 = Math.floor(seed / 4294967296);
	seed >>>= 0;
	//console.log(seed + " " + seed1);
	if (oldrng) {
		var s = [0xf1ea5eed, seed, seed, seed];
	} else {
		var s = [0xf1ea5eed, seed, seed1, seed];
    }

    for (var i = 0; i < 20; i++) jsf();
    return jsf;
}