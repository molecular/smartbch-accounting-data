import json_contracts from "./assets/config/contract.json";
import json_contract_abis from "./assets/config/contract-abi.json";

import Web3 from "web3";
import { NodeApiService } from './services/api/node-api.service';

export interface Contract {
	address: string;
	abiNames: string[];
	type?: string;
	name?: string;
	decimals?: number;
	symbol?: string;
}

export class ContractManager {
	api: NodeApiService;

	contracts: Contract[] = [];
	contract_abis = {};

	contracts_by_address = {};

	constructor(api: NodeApiService) {
		this.api = api;
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
				let call_string = method.name + "()";
				call_promises.push(
					this.api.call(
						{
							to: contract.address,
							data: "" + Web3.utils.sha3(call_string)
						}, method.return_type
					)
					.then((result) => {
						contract[method.name] = result;
						return contract;
					})
					.catch((error) => {
						contract[method.name] = "" + error;
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