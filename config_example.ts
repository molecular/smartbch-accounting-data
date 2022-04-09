export const config = {

	// the smartbch node rpc interface to use for pulling data
	rpc: { 
		url: 'https://smartbch.fountainhead.cash/mainnet:8545'
	},	

	// list the smartbch account adresses you want to export data for
	my_addresses: [ 
		'0x123adb4daa5...',
		'0xa5cef432ad1...',
	],

	// list of contracts to extract data for, use names from assets/config/contract.json
	contracts: [ 
		'flexUSD',
	],

	// used to write the CSV-columns post-fixed with "_" which are formatted copies
	output: { 
		divider_e: 18,
		decimals: 2
	}
}
