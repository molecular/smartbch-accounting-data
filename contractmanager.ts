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
  		this.addContract(contract)
  	});
  }

  addContract(contract: Contract) {
  	this.contracts_by_address[contract.address] = contract;
  }

  contractFromChain(address: string): Contract {
	 	var methods = [
	 		{name: "name", return_type: 'string'},
			{name: "decimals", return_type: 'uint8'},
			{name: "symbol", return_type: 'string'},
		];
		let contract: Contract = { 
			address,
			abiNames: ['sep20'] // best-effort assumption, worst that can happen is log decoding fail
		}
		Promise.all(methods.map((method) => {
			let call_string = method.name + "()";
			return this.api.call(
				{
					to: address,
					data: "" + Web3.utils.sha3(call_string)
				}, method.return_type
			)
			.then((result) => {
				contract[method.name] = result;
			});
		}))
		return contract;
  }

  public getContractByAddress(address: string): Contract {
  	address = address.toLowerCase();
  	let contract = this.contracts_by_address[address]
  	if (!contract) {
  		contract = this.contractFromChain(address)
 			this.addContract(contract);
 			return contract;
  	} else {
	  	return contract;
	  }
  }
}