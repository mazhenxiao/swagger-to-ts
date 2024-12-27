import http from 'http';
import fs from 'fs';
import path from 'path';
import rc from 'rc';
// const fromurl = 'http://172.17.203.130:8081/v3/api-docs'; //"http://10.0.11.89:8080/v3/api-docs"; // 接口文档地址
// const tourl = './api/schemaTypes.ts'; // 生成类型文件地址，必须和 toapi 在一个文件夹下
// const toapi = './api/schemaAPI.ts'; //  生成调用接口文件，和tourl 在一个文件夹下
// const servicePath = '@/utils/request'; // axios 地址，会被重命名为 service
const { fromurl, tourl, toapi, servicePath } = rc('isoftstone-swagger-to-ts', {
  fromurl: 'http://172.17.203.130:8081/v3/api-docs',
  tourl: './api/schemaTypes.ts',
  toapi: './api/schemaAPI.ts',
  servicePath: '@/utils/request',
});

const __dirname = path.dirname(import.meta.url);
const createType = value => {
  if (value['items'] && value['items']['$ref']) {
    return value['items']['$ref'].split('/').pop().replace(/[«,»]/gi, '');
  }
  if (
    value['additionalProperties'] &&
    value['additionalProperties']['items'] &&
    value['additionalProperties']['items']['$ref']
  ) {
    return value['additionalProperties']['items']['$ref']
      .split('/')
      .pop()
      .replace(/[«,»]/gi, '');
  }
  return 'any';
};
const createObj = data => {
  let typeObj = '';

  Object.entries(data).forEach(item => {
    const [key, value] = item;

    let typestr = 'any';
    if (value.type) {
      switch (value.type) {
        case 'string':
          typestr = 'string';
          break;
        case 'integer':
          typestr = 'number';
          break;
        case 'array':
          typestr = `Array<${createType(value)}>`;
          break;
        case 'object':
          typestr = `${createType(value)}`;
          break;
      }
    } else if (value['$ref']) {
      // 单独引用默认类型为JSON
      typestr = `${(value['$ref'] || '').split('/').pop()}`;
    } else if (value['items']['$ref']) {
      typestr = `${(value['items']['$ref'] || '').split('/').pop()}`;
    }
    typeObj += `
      ${key.replace(/[«,»]/gi, '')}: ${typestr.replace(/[«,»]/gi, '')};
    `;
  });
  return typeObj;
};
const createReqType = item => {
  let typestr = 'any';
  let typeObj = '';
  switch (item.schema.type) {
    case 'string':
      typestr = 'string';
      break;
    case 'integer':
      typestr = 'number';
      break;
  }
  typeObj += `${item.name.replace(/[«,»]/gi, '')}${
    item.required ? '' : '?'
  }: ${typestr.replace(/[«,»]/gi, '')};`;
  return typeObj;
};
const createReq = parameters => {
  console.log(parameters);
  let txt = `query:{ ${parameters
    .map(item => {
      return createReqType(item);
    })
    .join('')}}`;
  console.log(txt);
  return txt;
};

const createSchema = schemas => {
  let typeString = '';
  Object.entries(schemas).forEach(([key, value]) => {
    if (value?.properties) {
      typeString += `export type ${key.replace(
        /[«,»]/gi,
        ''
      )} = Partial<{ ${createObj(value.properties)}}>
      `;
    } else {
      typeString += `export type ${key.replace(/[«,»]/gi, '')} = any;
      `;
    }
  });
  console.log(typeString);
  return typeString;
};
// 生成类型
const createSchemaInput = jsonData => {
  console.log(jsonData);
  const text = createSchema(jsonData.components.schemas);
  const dir = path.dirname(tourl);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(tourl, text, {
    flag: 'w',
    encoding: 'utf-8',
  });
  // console.log(text);
  console.log('生成完成');
};

// 生成请求
const createParmas = data => {
  const { parameters, requestBody } =
    data['post'] || data['get'] || data['put'] || data['delete'];
  let query = '';
  let req = '';
  if (parameters) {
    query = createReq(parameters);
    // console.log(query);
  }
  if (requestBody) {
    const refs = Object.values(requestBody.content);
    if (refs && refs[0]) {
      if (refs[0]['schema']['$ref']) {
        req = `req:${(refs[0]['schema'] || { $ref: '' }).$ref
          .split('/')
          .pop()}`;
      } else {
        req = `req:any`;
        //  req = `req: ${Object.entries(refs[0]["schema"] || {}).forEach()}`;
      }
      try {
      } catch (e) {
        console.error(refs[0]);
        req = `req:any`;
      }
    }
  }

  // TODO：单独处理请求带入默认参数,因为swagger里没给出query 所以需要把这块写死
  if (!query) {
    query = `query: {pageNum?:number|string, pageSize?:number|string}`;
  }

  return [query, req];
};
const createRequest = data => {
  let text = '';
  let importType = new Set();
  Object.entries(data.paths).forEach(([key, value]) => {
    let [query, req] = createParmas(value);
    let method = Object.keys(value)[0];
    let methodData =
      value['get'] || value['post'] || value['put'] || value['delete'];
    let reqType = 'any';
    let content = methodData.responses?.['200']?.content
      ? Object.values(methodData.responses?.['200']?.content)
      : undefined;

    if (content && content[0]['schema']['$ref']) {
      reqType = content[0]['schema']['$ref']
        .split('/')
        .pop()
        .replace(/[«,»]/gi, '');
    }
    reqType = reqType.replace(/[«,»]/gi, '');

    const createPath = () => {
      //   "/system/dict/data/list?" + new URLSearchParams(req),
      return `"${key}"${query ? "+'?'+new URLSearchParams(query as any)" : ''}`;
    };
    //${[query, req].filter((item) => item).join(",")}
    // 类型倒入

    if (reqType) {
      importType.add(reqType);
    }
    if (req) {
      importType.add(req.split(':')[1]);
    }
    const createFunName = (key, operationId) => {
      return (
        '$' +
        key
          .replace(/[«,»]/gi, '')
          .replace(/\//gi, '_')
          .replace(/^_/gi, '')
          // .replace(/\{.*?\}/gi, '')
          .replace(/[{}]/gi, '')
          .replace(/\-/gi, '_')
        // +
        //operationId.replace(/\_\d+?/, '')
      );
    };

    text += `
        // README： 接口名称：${methodData['summary']} 路径： ${key}
        
        export const ${createFunName(key, methodData.operationId)} = (${[
      query,
      req,
    ]
      .filter(item => item)
      .join(',')})=>{
          let path = ${createPath()};
          ${
            query
              ? `
              // 替换路径参数
              if(path.includes("{")){
              path.match(/\{.*?\}/ig)?.forEach?.(item=>{
                   let keys = item.replace(/[{}]/ig,"");
                   if(query&&(query as any)[keys]){
                      path = path.replace("{"+keys+"}",(query as any)?.[keys]);
                   }
              })
            }`
              : ''
          }
          return service.${method.toLocaleUpperCase()}<${reqType}>(path${
      req ? ',req' : ''
    });
        }
      `;
    console.log(text);
  });

  // 引用
  const tsFile = `
  import service from "${servicePath}";
  import {${[...importType]
    .filter(item => !['null', 'any', 'undefined'].includes(item))
    .join(',')}} from  "./${tourl.split('/').pop().replace('.ts', '')}"
    ${text}
  `;
  const dir = path.dirname(toapi);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(toapi, tsFile, {
    flag: 'w',
    encoding: 'utf-8',
  });
};
const req = http.request(fromurl, res => {
  let data = '';
  res.setEncoding('utf8');
  res.on('data', chunk => {
    data += chunk;
  });
  res.on('end', () => {
    try {
      // Parse the received data as JSON.

      const jsonData = JSON.parse(data);
      createSchemaInput(jsonData); // 生成类型
      createRequest(jsonData); // 生成请求
    } catch (error) {
      console.error(`Error parsing JSON: ${error.message}`);
    }
  });
});
// Handle errors.
req.on('error', error => {
  console.error(`Error: ${error.message}`);
});

// End the request.
req.end();
