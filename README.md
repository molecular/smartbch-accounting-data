# smartbch-accounting-data
Tool to pull data that is relevant for financial accounting from a smartbch-node

  Caveat: there are know issues and potential problems. Always double-check the output data somehow and be careful. See section `caveats` below.

## Motivation and Overview

Getting data from EVM chains for accounting purposes (in case you want to pay taxes, you probably have this need) isn't a straight-forward streamlined process. This problem is even worse in new projects like smartBCH because many useful tools haven't been ported over from more mature chains like ethereum or are still not complete enough regarding the data they allow to pull from the chain. 

This tool tries to help with this issue by pulling data from a smartbch node and dumping it (after processing) to CSV files.

### Current version: mainly geared to flexUSD interest payments

getting a list of flexUSD interest payments is pretty hard: due to the way the flexUSD contract handles interest payments (using a multiplier approach) there are no separate transactions paying interest to each holder. Instead, a contract-global multiplier is used (and adjusten when interest is paid).

#### How this tool extracts flexUSD interest payments

## Installation

You'll need to install (at least) the following dependencies:
  
  * nodejs
  * npm
  * (please let me know what's missing)

Then run...

```
#> npm install
```

## Running

## Reporting problems

For now, please make an issue on github if you have problems or even if you need help.

## Caveats

