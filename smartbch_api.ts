import axios from "axios";
import Web3 from "web3";
import { Log } from 'web3-core';
import { Block, Transaction } from 'web3-eth';

import { AbiCoder } from "web3-eth-abi";
const abicoder: AbiCoder = require('web3-eth-abi');

import { UtilHelperService } from './services/helpers/util-helper.service'
const util = new UtilHelperService();

export interface TypedParameter {
	type: string;
	value: any;
}

export interface NamedReturnType {
	name?: string;
	type: string;
}

export class SmartBCHApi {
	rpc_endpoint: string;

	constructor(rpc_endpoint) {
		this.rpc_endpoint = rpc_endpoint;
	}

	// making requests

	rpc_request(method:string, params:Array<any> = [], log:boolean = false) : Promise<any> {
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
			return err;
		})
	}

	rpc_address_based(method:string, address:string, block="latest") {
		return this.rpc_request(method, [address, block]);
	}

	// public-facing functions exposing the api (incomplete)

	public blockNumber(): Promise<string> {
		return this.rpc_request("eth_blockNumber");
	}

	public getBlockByNumber(blockNumber: string, include_transactions: boolean): Promise<any> { // not sure it's really "include_transactions" semantically, but testing says yes, could be
		return this.rpc_request("eth_getBlockByNumber", [blockNumber, include_transactions]);
	}

	public getBlocksByNumbers(blockNumbers: string[]): Promise<any[]> {
		return Promise.all(blockNumbers.map((blockNumber) => this.getBlockByNumber(blockNumber, false)));
	}

  public getLogs(address: string|null, topics: (string | string[] | null)[], start: string | 'latest', end: string | 'latest'): Promise<Log[]> {
		return this.rpc_request("eth_getLogs", [{
			address: address,
			topics: topics,
			fromBlock: start,
			toBlock: end,
		}], false);
	}

	public queryTxByAddr(address: string, start: string | 'latest', end: string | 'latest', limit: string = "0x0"): Promise<void | Transaction[]> {
  	console.log("queryTxByAddr", address)
		return this.rpc_request(
			"sbch_queryTxByAddr", 
			[address, start, end, limit],
			false
		);
	}

	// public getTransactionByHash(txhash: string): Promise<void | Transaction[]> {
 //  	console.log("getTransactionByHash", txhash)
	// 	return this.rpc_request(
	// 		"getTransactionByHash", 
	// 		[txhash],
	// 		false
	// 	);
	// }

/*	public call(from: string | null, to: string | null, data: string | null, returnType?: string | string[] ): Promise<any> {
		returnType = returnType?returnType:'uint256'
		return this.rpc_request("eth_call", [
			{	to, data }, 
			'latest'
		], true)
		.then((result) => {
			if (Array.isArray(returnType)) {
				console.log("decoding", result, "using returnTypes", returnType);
				return abicoder.decodeParameters(returnType, result);
			} else {
				return abicoder.decodeParameter(returnType, result);
			}
		});
	}
*/
	public getTransactionReceipt(txhash: string) {
		return this.rpc_request(
			"eth_getTransactionReceipt", 
			[txhash],
			false
		);
	}

	public call(from: string | null, to: string | null, method_signature: string, parameters: TypedParameter[] = [], returnType?: string | NamedReturnType[] ): Promise<any> {
		returnType = returnType??'uint256'

		let data = parameters.reduce((o, p) => {
			//console.log("  para of type", p.type, "value", p.value, "encoded to", abicoder.encodeParameter(p.type, p.value).substring(2))
			return o + abicoder.encodeParameter(p.type, p.value).substring(2);
		}, Web3.utils.sha3(method_signature)?.substring(0,10))

		return this.rpc_request("eth_call", [
			{	to, data }, 
			'latest'
		], false)
		.then((result) => {
			if (Array.isArray(returnType)) {

				// TODO choose option 1: return values both indexed by position and returnType name
				//return abicoder.decodeParameters(returnType, result);

				// TODO choose option 2: return values only indexed by returnType name
				let return_values = abicoder.decodeParameters(returnType, result);
				return returnType.reduce((o, rt) => {
					let name = rt.name??'<anon>';
					o[name] = return_values[name];
					return o;
				}, {});
			} else {
				return abicoder.decodeParameter(returnType, result);
			}
		});
	}

}
