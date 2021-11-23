
"use strict";

module.exports = {
    isAdjacent: function (tile1, tile2) {
        return isAdjacent(tile1, tile2);
    },

    divideBigInt: function (numerator, denominator) {
        return divideBigInt(numerator, denominator, 6);
    },

    adjacentIterator: function (width, height, allTiles, tile) {
        return adjacentIterator(width, height, allTiles, tile);
    },

    tileAsText: function (tile) {
        return tileAsText(tile);
    }
}

// used to divide two BigInts together and return a normal number to 6 decimal places
const power10n = [BigInt(1), BigInt(10), BigInt(100), BigInt(1000), BigInt(10000), BigInt(100000), BigInt(1000000), BigInt(10000000)];
const power10 = [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000];

const adjacent = [[-1, -1], [0, -1], [1, -1], [-1, 0], [+1, 0], [-1, +1], [0, +1], [+1, +1]];


/*
 *   Returns true when two tiles are adjacent
 */
 function isAdjacent(tile1, tile2) {

    const dx = Math.abs(tile1.x - tile2.x);
    const dy = Math.abs(tile1.y - tile2.y);

    // adjacent and not equal
    if (dx < 2 && dy < 2 && !(dx == 0 && dy == 0)) {
        return true;
    } else {
        return false;
    }
}

/*
 *   Returns tile as literal "(x,y)"
 */
function tileAsText(tile) {
    return "(" + tile.x + "," + tile.y + ")";
}

/*
*   Divide some big integers back down to normal numbers 
*/
function divideBigInt(numerator, denominator, dp) {

    const work = numerator * power10n[dp] / denominator;

    const result = Number(work) / power10[dp];

    return result;
}

/*
 *   Iterator of adjacent tiles
 */  
function* adjacentIterator(width, height, allTiles, tile) {

    for (let i = 0; i < adjacent.length; i++) {

        const adj = adjacent[i];

        const x = tile.x + adj[0];
        const y = tile.y + adj[1];

        if (x < 0 || x >= width || y < 0 || y >= height) {
            continue;
        }

        const index = x + y * width;

        yield allTiles[index];

    }
}