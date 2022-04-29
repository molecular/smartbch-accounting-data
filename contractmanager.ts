import json_contracts from "./assets/config/contract.json";
import json_contract_abis from "./assets/config/contract-abi.json";

import Web3 from "web3";
import { SmartBCHApi } from './smartbch_api'

export interface Contract {
	address: string;
	abiNames: string[];
	type?: string;
	name?: string;
	decimals?: number;
	symbol?: string;
}

export class ContractManager {
	sbch: SmartBCHApi;

	contracts: Contract[] = [];
	contract_abis = {};

	contracts_by_address = {};

	constructor(sbch: SmartBCHApi) {
		this.sbch = sbch;
		// import contracts and contract_abis from json files
		this.contracts = json_contracts;
		//this.contract_abis = json_contract_abis;

		// index contracts by address
		this.contracts.forEach((contract) => {
			contract["freshly_from_json"] = true;
			this.addContract(contract)
		});
	}

	addContract(contract: Contract) {
		this.contracts_by_address[contract.address.toLowerCase()] = contract;
	}

	/* fill cache with contracts for given addresses pulling info from json and chain via calling sep20 method()s */

	public async loadContracts(addresses: string[]) {
		// remove dupes
		addresses = Object.keys(addresses.reduce((o, a) => { 
			o[a.toLowerCase()] = true;
			return o;
		}, {}));

		// call certain sep20-like methods on chain
		const methods = [
			{name: "name", return_type: 'string'},
			{name: "decimals", return_type: 'uint8'},
			{name: "symbol", return_type: 'string'},
			{name: "totalSupply", return_type: 'uint256'},
		];
		console.log("loading contracts for addresses: ", addresses);
		let call_promises: Promise<void | Contract>[] = []
		addresses.forEach((address) => {
			let contract: Contract = this.getContractByAddress(address);
			if (!contract) {
				contract = { 
					address,
					abiNames: ['sep20'] // best-effort assumption, worst that can happen is log decoding fail
				}
			}
			methods.forEach((method) => {
				call_promises.push(
					this.sbch.call(
						null, 
						contract.address, 
						method.name + "()", 
						undefined,
						method.return_type
					)
					.then((result) => {
						//console.log("call method", method.name, "result:", result);
						contract[method.name] = result;
						return contract;
					})
					.catch((error) => {
						//contract[method.name] = "" + error;
						return contract;
					})
				);
			})
		})
		return Promise.all(call_promises)
		.then((contracts) => {
			contracts.forEach((contract: void|Contract) => {
				if (contract) {
					this.addContract(contract as Contract);
				}
			});
		});
	}

	public getContractByAddress(address: string): Contract {
		return this.contracts_by_address[address.toLowerCase()];
	}
}