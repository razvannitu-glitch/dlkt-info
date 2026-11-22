import test from 'node:test';
import assert from 'node:assert/strict';
import {articlePhotoPath,parseArticlePhotoReference} from '../.build/src/media/article-photo-reference.js';

const globalRef=Object.freeze({id:'a'.repeat(24),revision:'b'.repeat(64)});
const localRef=Object.freeze({id:'local-news:683506:bucharest-b365:'+'c'.repeat(24),revision:'d'.repeat(64),cityId:'683506'});
test('article photo references round-trip exact record revisions without accepting a source URL',()=>{
 for(const reference of [globalRef,localRef]){
  const before=JSON.stringify(reference),path=articlePhotoPath(reference),parsed=parseArticlePhotoReference(path);
  assert.deepEqual(parsed,reference);assert.ok(Object.isFrozen(parsed));assert.equal(JSON.stringify(reference),before);
  assert.deepEqual(parseArticlePhotoReference(new URL(path,'https://www.dlkt.ee')),reference);
  const query=new URL(path,'https://www.dlkt.ee').searchParams;
  assert.equal(query.get('id'),reference.id);assert.equal(query.get('v'),reference.revision);
  assert.deepEqual([...query.keys()],reference.cityId?['id','v','city']:['id','v']);
 }
 const changed=articlePhotoPath({...globalRef,revision:'c'.repeat(64)});
 assert.notEqual(changed,articlePhotoPath(globalRef));assert.equal(parseArticlePhotoReference(changed).revision,'c'.repeat(64));
});
test('article photo references reject ambiguous, injected and mismatched record identities',()=>{
 for(const reference of [
  null,[],{}, {...globalRef,id:'A'.repeat(24)},{...globalRef,id:'a'.repeat(23)},
  {...globalRef,id:'https://example.org/article'},{...globalRef,revision:'b'.repeat(63)},
  {...globalRef,revision:'B'.repeat(64)},{...globalRef,cityId:'683506'},{...globalRef,cityId:undefined},
  {...globalRef,url:'https://example.org/photo.jpg'},{...globalRef,[Symbol('hidden')]:true},
  {id:localRef.id,revision:localRef.revision},{...localRef,cityId:'2988507'},
  {...localRef,cityId:'0683506'},{...localRef,id:localRef.id.replace('bucharest-b365','../b365')},
  {...localRef,id:localRef.id.replace('683506','0')},{...localRef,revision:'x'.repeat(64)},
 ])assert.throws(()=>articlePhotoPath(reference),/ARTICLE_PHOTO_REFERENCE_INVALID/u);
});
test('photo endpoint parsing accepts only the exact public route and one value per allowed field',()=>{
 const path=articlePhotoPath(globalRef);
 for(const value of [
  '', '/api/card-image'+path.slice('/api/article-photo'.length), path.replace('/api/article-photo','/api/x/../article-photo'),
  path.replace('/api/article-photo','/api/%61rticle-photo'),path+'#fragment',path+'#',path+' ',
  path+'\n',path.replace('/api/','\\api\\'),'//www.dlkt.ee'+path,'http://www.dlkt.ee'+path,
  'https://evil.example'+path,'https://info.dlkt.ee'+path,'https://www.dlkt.ee:443'+path,
  'https://user@www.dlkt.ee'+path,path+'&id='+globalRef.id,path+'&v='+globalRef.revision,
  path+'&url=https%3A%2F%2Fexample.org%2Fphoto.jpg',path+'&city=683506',path+'&unknown=1',
  path.replace('?id=','?i%64='),path.replace('&v=','&%76='),path.replace('?id='+globalRef.id+'&','?'),
  path.replace('&v='+globalRef.revision,''),articlePhotoPath(localRef)+'&city=683506',
  articlePhotoPath(localRef).replace('city=683506','city=2988507'),
 ])assert.equal(parseArticlePhotoReference(value),null,value);
});
