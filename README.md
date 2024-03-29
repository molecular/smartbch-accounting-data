# smartbch-accounting-data

![output teaser](doc/output_teaser.png)

Tool to pull data that is relevant for financial accounting from a smartbch-node via json rpc interface

> Caveat: there are know issues and potential problems. Always double-check the output data somehow and be careful. See section `caveats` below.

## Motivation and Overview

Getting data from EVM chains for accounting purposes (in case you want to pay taxes, you probably have this need) isn't a straight-forward streamlined process. This problem is even worse in new projects like smartBCH because many useful tools haven't been ported over from more mature chains like ethereum or are still not complete enough regarding the data they allow to pull from the chain. 

This tool tries to help with this issue by pulling data from a smartbch node and dumping it (after processing) to CSV files.

### How this tools extracts data

The general mode of operation of this tool is:

 * collect transactions (using `queryTxByAddr` RPC call) having any of the `my_addresses` from config file as source or destination
   * write transactions to `out/transactions/transactions.csv`
   * decode transaction inputs and write to `out/transactions/decoded_inputs.csv` and `out/transactions/decoded_input_parameters.csv`
 * extract log events from these transactions using `getTransactionReceipt` RPC call
 * add to those log events data from `getLogs` RPC call with topic patterns matching anything that contains any of the configured `my_addresses` as one of the first 3 parameters. This will have overlap with the log events from transactions, but also add some in case the external transaction does not involve any of the `my_addresses`
 * add to those log events data from `getLogs` RPC call with topic patterns matching flexUSD contract's ChangeMulitplier event (needed for generating synthetic interest payment Transfers)
 * generates synthetic (fake) Transfer events for flexUSD interest payments by tracking flexUSD account balance and calculating interest payment amount using this balance and the new ChangeMultiplier from above-mentioned ChangeMultiplier-event. 
 * decode those log events and write them (categorized by event name) to `out/events/<event name>.csv`

#### How exactly this tool extracts flexUSD interest payments

For flexUSD contract specifically, there is an event named `ChangeMultiplier`. flexUSD uses a multiplier that is applied to account balances on operations that read or write account balances. That was interest can be paid to all accounts simply by increasing this multiplier. The downside is that there are not separate interest payment transactions to the accounts.

Given an account, this tool chronologically walks through the associated `Transfer` and `ChangeMultiplier` events, tracking the account balance. For each `ChangeMultiplier` event a synthetic event mimiking a `Transfer` event is created (it's named `Transfer`, but abi is `<synthetic, interest payment>`). Those events are mixed with the real `Transfer` events for output to file `Transfer.csv`.

> Caveat: I see a couple of ways this approach could fail. It would probably be better to use `flexUSD.getBalance(<account>)` to arrive at the balance instead of tracking transfers and aggregating the deltas.

## Usage

### Installation

You'll need to install (at least) the following dependencies:
  
  * nodejs
  * npm
  * (please let me know what's missing)

Then run...

```
#> npm install
```

> you might have to restart your terminal/shell to make commands like `npx` available in your $PATH

### Configuration

First copy the `config_example.ts` config file to `config.ts` and edit it

```
#> cp config.example.ts config.ts
#> edit config.ts
```

main task here is to configure your list of smartbch accounts `my_addresses`

### Running

Before running it's probably a good idea to remove any .csv file from previous runs to not end up with stale data.

Theres many ways to compile/run a typescript project. One is:

```
#> rm -f out/*.csv; npx ts-node index.ts 
```

### Output

You'll (hopefully) end up with a bunch of CSV files in out/ Folder. Example:

![output files](doc/output_files.png)

## Telegram group for Support, Feedback, Discussion

for support, feedback and discussion, please use [telegram group smartbch-accounting-data](https://t.me/smartbch_accounting_data)

## Caveats, Issues

 * Everything (including output CSV columns, formats, etc...) is still in flux. Don't depend on things staying the same over time.
 * The general approach used to create flexUSD interest payment events may or may not work well all cases (there are other ideas, but for now it's what it is, see above for a description), please sanity-check the output.
 * see [TODO](TODO)

