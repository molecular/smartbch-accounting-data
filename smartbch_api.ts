import axios from "axios";
import Web3 from "web3";
import { Log } from 'web3-core';
import { Block, Transaction } from 'web3-eth';

import { AbiCoder } from "web3-eth-abi";
const abicoder: AbiCoder = require('web3-eth-abi');

import { UtilHelperService } from './services/helpers/util-helper.service'
const util = new UtilHelperService();

export class SmartBCHApi {
	rpc_endpoint: string;

	constructor(rpc_endpoint) {
		this.rpc_endpoint = rpc_endpoint;
	}

	// making requests

	rpc_request(method:string, params:Array<any> = [], log:boolean = false) {
		let pars = {
			"jsonrpc": "2.0", 
			"method": method, 
			"params": params,
			"id":1
		};
		return axios.post(this.rpc_endpoint, pars).then( (res) => {
			if (log) {
				console.log(`\nmethod: ${method}, params`);
				pars.params.forEach((item,index) => {
					console.log(`[${index}]: ${JSON.stringify(item)}`);
				});
				console.log(res.data);
			}
			return res.data.result
		}).catch( (err) => {
			console.log("error:", err);
		})
	}

	rpc_address_based(method:string, address:string, block="latest") {
		return this.rpc_request(method, [address, block]);
	}

	// public-facing functions exposing the api (incomplete)

	public blockNumber(): Promise<string> {
		return this.rpc_request("eth_blockNumber");
	}

	public getBlockByNumber(blockNumber: string): Promise<any> {
		return this.rpc_request("eth_getBlockByNumber", [blockNumber, true]);
	}

	public getBlocksByNumbers(blockNumbers: string[]): Promise<any[]> {
		return Promise.all(blockNumbers.map((blockNumber) => this.getBlockByNumber(blockNumber)));
	}

  public getLogs(address: string|null, topics: (string | string[] | null)[], start: string | 'latest', end: string | 'latest'): Promise<Log[]> {
		return this.rpc_request("eth_getLogs", [{
			address: address,
			topics: topics,
			fromBlock: start,
			toBlock: end,
		}], false);
	}

	public queryTxByAddr(from: string, start: string | 'latest', end: string | 'latest', limit: string): Promise<Transaction[]> {
		return this.rpc_request("sbch_queryTxByAddr", [from, start, end, limit]);
	}

	public call(from: string | null, to: string | null, data: string | null, returnType?: string ): Promise<any> {
		returnType = returnType?returnType:'uint256'
		return this.rpc_request("eth_call", [
			{	to, data }, 
			'latest'
		], false)
		.then((result) => {
			return abicoder.decodeParameter(returnType, result);			
		});
	}
}
