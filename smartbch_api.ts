import axios from "axios";
import { Hex } from 'web3-utils';
import { Log } from 'web3-core';

// import { UtilHelperService } from './services/helpers/util-helper.service'
// const util = new UtilHelperService();

export class SmartBCHApi {
	rpc_endpoint: string;

	constructor(rpc_endpoint) {
		this.rpc_endpoint = rpc_endpoint;
	}

	// making requests

	rpc_request(method:string, params:Array<any> = [], log:boolean = true) {
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

	// public-facing function

	public queryTxByAddr(from: string, start: Hex | 'latest', end: Hex | 'latest', limit: Hex): Promise<any> {
		return this.rpc_request("sbch_queryTxByAddr", [from, start, end, limit]);
	}

  public eth_getLogs(address: string|null, topics: (string | string[] | null)[], start: number, end: number): Promise<Log[]> {
		return this.rpc_request("eth_getLogs", [{
			address: address,
			topics: topics,
			fromBlock: start,
			toBlock: end,
		}]);
	}
}
