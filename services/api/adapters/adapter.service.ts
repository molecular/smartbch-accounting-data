import { BlockNumber, Log, TransactionConfig, TransactionReceipt } from 'web3-core';
import { Block, Transaction } from 'web3-eth';
import { Hex } from 'web3-utils';
import { SBCHSource } from '../node-api.service';

export abstract class NodeAdapter {

  abstract init(endpoint: string): Promise<boolean>;
  abstract getChainId(): Promise<number>;
  abstract getBlockHeader(): Promise<number>
  abstract getBlock(blockId: BlockNumber): Promise<Block>;
  abstract getBlocks(blockIds: BlockNumber[]): Promise<Block[]>;
  abstract getTxsByBlock(blockId: BlockNumber, start?: number, end?: number): Promise<TransactionReceipt[]>;
  abstract getTxByHash(hash: string): Promise<Transaction>;
  abstract getTxReceiptByHash(hash: string): Promise<TransactionReceipt>;
  abstract getTxReceiptsByHashes(hashes: string[]): Promise<TransactionReceipt[]>;
  abstract getTxCount(address: string, type: SBCHSource): Promise<Hex>;
  // abstract getTxListByHeightWithRange
  abstract getSep20AddressCount(address: string, sep20Contract: string, type: SBCHSource): Promise<any>;
  abstract getAccountBalance(address: string): Promise<string>;
  abstract getCode(address: string): Promise<string>;
  abstract queryLogs(address: string, data: any[] | null, start: string, end: string, limit: string): Promise<Log[]>;
  abstract getLogs(address: string|null, topics: (string | string[] | null)[], start: string, end: string, limit: string): Promise<Log[]>;
  abstract queryAddressLogs(address: string): Promise<Log[]> | undefined;
  abstract call(transactionConfig: TransactionConfig, returnType: string): Promise<any>;
  abstract callMultiple(items: {transactionConfig: TransactionConfig, returnType: string}[]): Promise<any>;

  /**
   * Gets txs for account
   * @param address address to search for
   * @param [page] the requested page
   * @param [pageSize] amount of txs to return
   * @param [searchFromBlock] search from a specific block number. Defaults to latest block
   * @param [scopeSize] how many blocks deep into the chain to search. Defaults to full chain
   * @returns
   */
  abstract getTxsByAccount(
    address: string,
    page: number,
    pageSize: number,
    type?: SBCHSource,
    searchFromBlock?: number,
    scopeSize?: number
  ): Promise<Transaction[]>;

  abstract getLatestTransactions(page: number, pageSize: number, searchFromBlock?: number, scopeSize?: number): Promise<Transaction[]>;
  abstract hasMethodFromAbi(address: string, method: string, abi: any): Promise<boolean>;

  abstract ensNameLookup(address: string): Promise<string>;
  abstract ensAddressLookup(name: string): Promise<string>;
}
