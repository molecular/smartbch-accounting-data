import { NodeAdapter } from '../adapter.service';

import { isString, map, noop, orderBy, sumBy, union } from 'lodash';

import { Web3Connector, Web3ConnectorType } from './web3.connector';

import Web3 from 'web3';
import { BlockNumber, Log, Transaction, TransactionConfig, TransactionReceipt } from 'web3-core';
import { Block } from 'web3-eth';
import { SBCHSource } from '../../node-api.service';
import { Hex } from 'web3-utils';

import { Mutex } from 'async-mutex';
const nameMutex = new Mutex();
const addressMutex = new Mutex();

const namehash = require('eth-ens-namehash');

const ENS_REGISTRY_ADDRESS_MAP: {[chainId: number]: string} = {
  [10000]: "0xCfb86556760d03942EBf1ba88a9870e67D77b627",
  [10001]: "0x32f1FBE59D771bdB7FB247FE97A635f50659202b",
}

export const DEFAULT_QUERY_SIZE = 100000; // max block range per request
export class Web3Adapter implements NodeAdapter{
  apiConnector?: Web3Connector;

  constructor() {}
  nameCache: Map<string, string> = new Map<string,string>();
  addressCache: Map<string, string> = new Map<string,string>();

  init(endpoint: string) {
    if(!endpoint) return Promise.reject();

    this.nameCache.clear();
    this.addressCache.clear();

    console.log('[Node Adapter:Web3] Initializing web3', endpoint);
    let connectorType: Web3ConnectorType = null;

    endpoint.startsWith('ws://') || endpoint.startsWith('wss://') ? connectorType = 'ws' : noop();
    endpoint.startsWith('http://') || endpoint.startsWith('https://') ? connectorType = 'http' : noop();
    try {
      this.apiConnector = new Web3Connector(endpoint, connectorType);
      const web3 = this.apiConnector.web3!;
      web3.eth.getChainId().then(chainId => {
        web3.eth.ens.registryAddress = ENS_REGISTRY_ADDRESS_MAP[chainId];
      });
    } catch(error) {
      console.log('[Node Adapter:Web3] Error connecting to node', error);
      localStorage.removeItem('connection-config');
      return Promise.reject();
    }

    return Promise.resolve(true);
  }

  getChainId(): Promise<number> {
    if(!this.apiConnector) return Promise.reject();

    return this.apiConnector.getChainId();
  }

  getBlockHeader(): Promise<number> {
    if(!this.apiConnector) return Promise.reject();

    return this.apiConnector.getBlockNumber();
  }
  getBlock(blockId: BlockNumber): Promise<Block> {
    if(!this.apiConnector) return Promise.reject();

    return this.apiConnector.getBlock(blockId);
  }
  getBlocks(blockIds: BlockNumber[]): Promise<Block[]> {
    if(!this.apiConnector) return Promise.reject();

    return this.apiConnector.getBlocks(blockIds);
  }

  getTxsByBlock(blockId: string, start?: number, end?: number): Promise<TransactionReceipt[]> {
    if(!this.apiConnector) return Promise.reject();
    if(start !== undefined && end !== undefined) {
      return this.apiConnector.getTxListByHeightWithRange(blockId, start, end);
    }
    return this.apiConnector.getTxListByHeight(blockId);
  }

  getTxsByBlocks(blockIds: string[]) {
    if(!this.apiConnector) return Promise.reject();

    return this.apiConnector.getTxListByHeights(blockIds)
  }

  getTxByHash(hash: string): Promise<Transaction> {
    if(!this.apiConnector) return Promise.reject();

    return this.apiConnector.getTransaction(hash);
  }

  getTxsByHashes(hashes: string[]) {
    if(!this.apiConnector) return Promise.reject();

    return this.apiConnector.getTransactions(hashes);
  }

  async getTxsByAccount(address: string, page: number, pageSize: number, type?: SBCHSource, searchFromBlock?: number, scopeSize?: number) {
    const totalTxInAddress = Web3.utils.hexToNumber(await this.getTxCount(address, type));

    if(!this.apiConnector) return Promise.reject();
    if(!searchFromBlock) searchFromBlock = await this.getBlockHeader(); // default to current blockheader if not supplied, so we search from the tip of the chain

    if(!scopeSize) scopeSize = 0;

    let scopeBlockId = searchFromBlock - scopeSize > 0 ? searchFromBlock - scopeSize : 0; // Will stop searching when this blockId is reached.
    let startIndex = (page - 1) * pageSize;
    let endIndex = (startIndex + pageSize);

    if(endIndex > totalTxInAddress) {
      endIndex = totalTxInAddress;
    }

    let txFound: Transaction[] = [];

    let querySize = DEFAULT_QUERY_SIZE;
    let to = searchFromBlock;
    let from = to - querySize;
    let extendQueryBy = 1;

    // console.log('endIndex', endIndex);
    // console.log('page', page);
    // console.log('pageSize', pageSize);
    // console.log('totalTxInAddress', totalTxInAddress);
    // console.log('scope', scopeBlockId);
    // console.log('from', from);
    // console.log('to', to);
    // console.log('start', startIndex);
    // console.log('end', endIndex);

    if(totalTxInAddress) {
      // get the txs from node. requests will be divided in chuncks set by query size. Will stop when we reach the end of the chain, or when requested txs in page have been found.
      do {
        // don't search beyond scope
        if(from < scopeBlockId) from = scopeBlockId;
        if(to < scopeBlockId) to = scopeBlockId;

        // console.log(`Fetching txs from block ${from} to ${to}`);
        let txInThisPage: Transaction[] = [];
        let limitReached = false;
        try {
          if(type === 'both') {
            txInThisPage = await this.apiConnector.queryTxByAddr(
              address,
              Web3.utils.numberToHex(to),
              Web3.utils.numberToHex(from),
              pageSize * page
            )
          }

          if(type === 'from') {
            txInThisPage = await this.apiConnector.queryTxBySrc(
              address,
              Web3.utils.numberToHex(to),
              Web3.utils.numberToHex(from),
              pageSize * page
            )
          }

          if(type === 'to') {
            txInThisPage = await this.apiConnector.queryTxByDst(
              address,
              Web3.utils.numberToHex(to),
              Web3.utils.numberToHex(from),
              pageSize * page
            )
          }
        } catch(error: any) {
          // console.error('sbch_queryTx Error!', error.message, pageSize * page, from, to);
          // console.table(error);

          if(error.message.startsWith("Returned error: too many candidicate entries")) {
            console.log('Limit reached');
            limitReached = true;
            extendQueryBy = 1;

            if(querySize > 1) {
              querySize = Math.floor(querySize / 2);
            }
            from = to - querySize;
          }
        }

        if  (txInThisPage.length) {
          txFound = txFound.concat(txInThisPage);
          extendQueryBy = 1;
          querySize = DEFAULT_QUERY_SIZE
          // console.log(`Found ${txFound.length} transactions`)
        } else {
          if(extendQueryBy < 10000) extendQueryBy = extendQueryBy * 50;
          // console.log('extended query size', extendQueryBy)
        }

        if(!limitReached) {
          to = from - 1;
          from = from - (querySize * extendQueryBy);
        }

      } while ( txFound.length < (endIndex) && to > scopeBlockId );

      txFound = map(txFound, (tx) => {
        if(isString(tx.blockNumber)) {
          // convert blocknumber to int. sbch returns these as hexes, while Web3 Transaction expects them to be number
          tx.blockNumber = Web3.utils.hexToNumber(tx.blockNumber as any)

          return tx;
        }

        return tx;
      });

      txFound = orderBy(txFound, ['blockNumber'], ['desc']);
    }

    const txResults = txFound.slice(startIndex, endIndex);

    return txResults as Transaction[];
  }

  async getLatestTransactions(page: number, pageSize: number, searchFromBlock?: number, scopeSize?: number) {
    if(!this.apiConnector) return Promise.reject();
    if(!searchFromBlock) searchFromBlock = await this.getBlockHeader();
    if(!scopeSize) scopeSize = 0;

    let scope = searchFromBlock - scopeSize; // Will stop searching when this blockId is reached
    if(scope < 0) scope = 0;

    let startIndex = (page - 1) * pageSize;
    let endIndex = (startIndex + pageSize);
    let txFound: string[] = [];
    let txsFound: TransactionReceipt[] = [];

    let to = searchFromBlock;
    let from = to - 1;

    let extendedQueryBy = 1;

    // console.log('scope', scope);
    // console.log('from', from);
    // console.log('to', to);

    do {
      // console.log('scope', scope);
      // console.log('from', from);
      // console.log('to', to);

      // don't search beyond scope
      if(from < scope) from = scope;
      if(to < scope) to = scope;

      const ids: number[] = []
      for(let i = from; i <= to; i++) {
        ids.push(i)
      }

      // console.log('ids', ids);

      const txs = await this.apiConnector.getTxListByHeights(map(ids, id => Web3.utils.numberToHex(id)));

      if (txs.length) {
        txsFound = txsFound.concat(txs);
        extendedQueryBy = 1;
      } else {
        // if we didnt find anything, double query size
        if(extendedQueryBy < 10000) extendedQueryBy = extendedQueryBy * 2;
        if(extendedQueryBy > 10000) extendedQueryBy = 10000;
      }

      to = from - 1;
      from = from - (1 * extendedQueryBy);
    } while ( txsFound.length <= (endIndex) && to > scope );


    txsFound = orderBy(txsFound, ['blockNumber'], ['desc']);

    txsFound = map(txsFound, tx => {
      tx.blockNumber = Web3.utils.hexToNumber(tx.blockNumber as Hex);
      return tx;
    });

    const txResults = txsFound.slice(startIndex, endIndex);
    const hashes = map(txResults, result => result.transactionHash);
    let transactions: Transaction[] = [];
    if (hashes.length) {
      transactions = await this.apiConnector.getTransactions(hashes);
    }

    return transactions as Transaction[];

  }

  getTxCount(address: string, type: SBCHSource = 'both') {
    if(!this.apiConnector) return Promise.reject();

    return this.apiConnector.getTransactionCount(address, type);
  }

  getSep20AddressCount(address: string, sep20Contract: string, type: SBCHSource): Promise<any> {
    if(!this.apiConnector) return Promise.reject();

    return this.apiConnector.getSep20TransactionCount(address, sep20Contract, type);
  }
  getAccountBalance(address: string): Promise<string> {
    if(!this.apiConnector) return Promise.reject();

    return this.apiConnector.getBalance(address);
  }

  getCode(address: string): Promise<string> {
    if(!this.apiConnector) return Promise.reject();

    return this.apiConnector.getCode(address);
  }
  getTxReceiptByHash(hash: string): Promise<TransactionReceipt> {
    if(!this.apiConnector) return Promise.reject();

    return this.apiConnector.getTransactionReceipt(hash)
  }
  getTxReceiptsByHashes(hashes: string[]): Promise<TransactionReceipt[]> {
    if(!this.apiConnector) return Promise.reject();

    return this.apiConnector.getTransactionReceipts(hashes);
  }
  async call(transactionConfig: TransactionConfig, returnType: string) {
    if(!this.apiConnector) return Promise.reject();

    let callReturn: {[key: string]: any} | undefined;

    await this.apiConnector.call(transactionConfig).then( (call) => {
      callReturn = this.apiConnector?.getWeb3()?.eth.abi.decodeParameter(returnType, call);
    });

    if(!callReturn) {
      return Promise.reject();
    }

    return Promise.resolve(callReturn);
  }

  async callMultiple(items: {transactionConfig: TransactionConfig, returnType: string}[]) {
    if(!this.apiConnector) return Promise.reject();

    let callReturn: {[key: string]: any}[] = [];

    const callResult = await this.apiConnector.callMultiple(map(items, item => item.transactionConfig));

    for(let i = 0; i < items.length; i++) {
      const returnValue = this.apiConnector?.getWeb3()?.eth.abi.decodeParameter(items[i].returnType, callResult[i])
      if(returnValue) {
        callReturn.push(
          returnValue
        );
      }
    }

    return Promise.resolve(callReturn);
  }

  queryLogs(address: string, data: any[], start: string, end: string, limit: string) {
    if(!this.apiConnector) return Promise.reject();
    return this.apiConnector.queryLogs(address, data, start, end, limit);
  }

  getLogs(address: string|null, topics: (string | null)[], start: string, end: string, limit: string) {
    if(!this.apiConnector) return Promise.reject();
    return this.apiConnector.getLogs(address, topics, start, end, limit);
  }

  queryAddressLogs(address: string): Promise<Log[]> | undefined {
    return this.apiConnector?.queryAddressLogs(address);
  }

  async hasMethodFromAbi(address: string, method: string, abi: any): Promise<boolean> {
    const myMethod = Web3.utils.sha3("symbol()");
    // const myMethod2 = Web3.utils.sha3("name()");
    const myMethod3 = Web3.utils.sha3("totalSupply()");

    // if(myMethod3) {
    //   this.call({ to: address, data: myMethod3}).then( call => {
    //     console.log('SUPPLY', this.apiConnector?.decodeParameter("uint256", call));
    //   });
    // }

    // if(myMethod2) {
    //   this.call({ to: address, data: myMethod2}).then( call => {
    //     console.log('NAME', abi.decodeParameter("string", call));
    //   });
    // }

    this.queryLogs(
      address,
      [
        Web3.utils.keccak256('Transfer(address,address,uint256)'),
        // web3.utils.sha3('Deposit(address,uint256)'),
        // web3.utils.sha3('Withdrawal(address,uint256)'),

      ],
      '0x0',
      'latest',
      '0x0'
    ).then(result => {
      console.log('sbch', result)
      console.log( Web3.utils.stringToHex(result[0].topics[1] ));
    })

    // if (myMethod) {
    //   this.call({ to: address, data: myMethod}).then( call => {
    //     console.log('SYMBOL', web3.eth.decodeParameter("string", call));
    //     console.log(Web3.utils.keccak256('Transfer(address,address,uint256)'))
    //     console.log(Web3.utils.keccak256('transfer(address,uint256)'))



    //     // web3.eth.getPastLogs({
    //     //   fromBlock: '0x0',
    //     //   address: address,
    //     //   topics: [
    //     //     web3.utils.sha3('Transfer(address,address,uint256)')
    //     //   ]
    //     // }).then( result => {
    //     //   console.log('PAST LOGS', result);

    //     //   console.log( web3.utils.stringToHex(result[0].topics[1] ));
    //     // })

    //   })
    //   .catch(error => {
    //     console.log('NO METHOD', error)
    //   });
    // }

    return Promise.resolve(false);
  }

  async ensNameLookup(address: string): Promise<string> {
    if(!this.apiConnector) return Promise.reject();

    const cached = this.nameCache.get(address);
    if (cached !== undefined) {
      return cached;
    }

    const result = await nameMutex.runExclusive<string>(async () => {
      const cached = this.nameCache.get(address);
      if (cached !== undefined) {
        return cached;
      }

      const reverseName = (address?.substring(2).toLowerCase() ?? "") + ".addr.reverse";
      const resolver = await this.apiConnector!.web3!.eth.ens.getResolver(reverseName);
      let name = "";
      try {
        name = await resolver.methods.name(namehash.hash(reverseName)).call();
      } catch {}
      this.nameCache.set(address, name);
      return name;
    });
    return result;
  }

  async ensAddressLookup(name: string): Promise<string> {
    if(!this.apiConnector) return Promise.reject();

    const cached = this.addressCache.get(name);
    if (cached !== undefined) {
      return cached;
    }

    const result = await addressMutex.runExclusive<string>(async () => {
      const cached = this.addressCache.get(name);
      if (cached !== undefined) {
        return cached;
      }

      let address = "";
      try {
        address = await this.apiConnector!.web3!.eth.ens.getAddress(name);
      } catch {}
      this.addressCache.set(name, address);
      return address;
    });
    return result;
  }
}
